const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Budget = require('../models/Budget');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticação em todas as rotas
router.use(authenticate);

// Validações
const transactionValidation = [
  body('description')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Descrição deve ter entre 1 e 100 caracteres'),
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Valor deve ser maior que zero'),
  body('type')
    .isIn(['income', 'expense'])
    .withMessage('Tipo deve ser income ou expense'),
  body('date')
    .optional()
    .isISO8601()
    .withMessage('Data deve estar no formato ISO8601'),
  body('categoryId')
    .optional()
    .isMongoId()
    .withMessage('ID da categoria inválido')
];

// GET /api/transactions/stats - Estatísticas (ANTES de /:id)
router.get('/stats', [
  query('startDate').optional().isISO8601().withMessage('Data inicial inválida'),
  query('endDate').optional().isISO8601().withMessage('Data final inválida')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Parâmetros inválidos',
        errors: errors.array()
      });
    }

    const { startDate, endDate } = req.query;

    // Estatísticas gerais
    const stats = await Transaction.getStats(req.userId, startDate, endDate);
    
    // Estatísticas por categoria
    const categoryStats = await Transaction.aggregate([
      {
        $match: {
          userId: req.userId,
          isDeleted: { $ne: true },
          status: 'completed',
          ...(startDate || endDate ? {
            date: {
              ...(startDate && { $gte: new Date(startDate) }),
              ...(endDate && { $lte: new Date(endDate) })
            }
          } : {})
        }
      },
      {
        $group: {
          _id: { type: '$type', categoryId: '$categoryId' },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id.categoryId',
          foreignField: '_id',
          as: 'category'
        }
      },
      {
        $project: {
          type: '$_id.type',
          categoryId: '$_id.categoryId',
          category: { $arrayElemAt: ['$category', 0] },
          total: 1,
          count: 1
        }
      },
      {
        $sort: { total: -1 }
      }
    ]);

    // Transações recentes
    const recentTransactions = await Transaction.find({
      userId: req.userId,
      isDeleted: { $ne: true }
    })
      .populate('categoryId', 'name icon color')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      data: {
        summary: stats[0] || {
          income: 0,
          expense: 0,
          balance: 0,
          incomeCount: 0,
          expenseCount: 0,
          totalTransactions: 0
        },
        categoryStats,
        recentTransactions
      }
    });

  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/transactions/bulk - Criar múltiplas transações (ANTES de /:id)
router.post('/bulk', async (req, res) => {
  try {
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Array de transações é obrigatório'
      });
    }

    if (transactions.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Máximo de 100 transações por vez'
      });
    }

    // Validar cada transação
    const validTransactions = [];
    const errors = [];

    for (let i = 0; i < transactions.length; i++) {
      const trans = transactions[i];
      
      if (!trans.description || !trans.amount || !trans.type) {
        errors.push(`Transação ${i + 1}: campos obrigatórios faltando`);
        continue;
      }

      if (trans.amount <= 0) {
        errors.push(`Transação ${i + 1}: valor deve ser positivo`);
        continue;
      }

      if (!['income', 'expense'].includes(trans.type)) {
        errors.push(`Transação ${i + 1}: tipo inválido`);
        continue;
      }

      validTransactions.push({
        ...trans,
        userId: req.userId,
        syncedAt: new Date()
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Algumas transações são inválidas',
        errors
      });
    }

    // Inserir transações
    const insertedTransactions = await Transaction.insertMany(validTransactions);

    // Atualizar orçamentos para gastos
    const expenseCategories = new Set();
    insertedTransactions.forEach(trans => {
      if (trans.type === 'expense' && trans.categoryId) {
        expenseCategories.add(trans.categoryId.toString());
      }
    });

    for (const categoryId of expenseCategories) {
      await updateBudgetSpent(categoryId, req.userId);
    }

    res.status(201).json({
      success: true,
      message: `${insertedTransactions.length} transações criadas com sucesso`,
      data: {
        count: insertedTransactions.length,
        transactions: insertedTransactions
      }
    });

  } catch (error) {
    console.error('Erro ao criar transações em lote:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/transactions - Listar transações
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Página deve ser um número positivo'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limite deve ser entre 1 e 100'),
  query('type').optional().isIn(['income', 'expense']).withMessage('Tipo inválido'),
  query('categoryId').optional().isMongoId().withMessage('ID da categoria inválido'),
  query('startDate').optional().isISO8601().withMessage('Data inicial inválida'),
  query('endDate').optional().isISO8601().withMessage('Data final inválida')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Parâmetros inválidos',
        errors: errors.array()
      });
    }

    const {
      page = 1,
      limit = 20,
      type,
      categoryId,
      startDate,
      endDate,
      search
    } = req.query;

    // Filtros
    const filters = { userId: req.userId };
    
    if (type) filters.type = type;
    if (categoryId) filters.categoryId = categoryId;
    
    if (startDate || endDate) {
      filters.date = {};
      if (startDate) filters.date.$gte = new Date(startDate);
      if (endDate) filters.date.$lte = new Date(endDate);
    }

    if (search) {
      filters.$or = [
        { description: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }

    // Paginação
    const skip = (page - 1) * limit;

    // Buscar transações
    const transactions = await Transaction.find(filters)
      .populate('categoryId', 'name icon color')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Contar total
    const total = await Transaction.countDocuments(filters);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Erro ao listar transações:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/transactions/:id - Buscar transação específica (DEPOIS das rotas específicas)
router.get('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.userId
    }).populate('categoryId', 'name icon color');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transação não encontrada'
      });
    }

    res.json({
      success: true,
      data: { transaction }
    });

  } catch (error) {
    console.error('Erro ao buscar transação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/transactions - Criar transação
router.post('/', transactionValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const transactionData = {
      ...req.body,
      userId: req.userId
    };

    // Verificar se categoria existe e pertence ao usuário
    if (transactionData.categoryId) {
      const category = await Category.findOne({
        _id: transactionData.categoryId,
        userId: req.userId,
        isActive: true
      });

      if (!category) {
        return res.status(400).json({
          success: false,
          message: 'Categoria não encontrada'
        });
      }

      // Verificar se o tipo da transação é compatível com a categoria
      if (category.type !== 'both' && category.type !== transactionData.type) {
        return res.status(400).json({
          success: false,
          message: 'Tipo de transação incompatível com a categoria'
        });
      }
    }

    const transaction = new Transaction(transactionData);
    await transaction.save();

    // Atualizar orçamentos se for gasto
    if (transaction.type === 'expense' && transaction.categoryId) {
      await updateBudgetSpent(transaction.categoryId, req.userId);
    }

    // Buscar transação criada com dados da categoria
    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('categoryId', 'name icon color');

    res.status(201).json({
      success: true,
      message: 'Transação criada com sucesso',
      data: { transaction: populatedTransaction }
    });

  } catch (error) {
    console.error('Erro ao criar transação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/transactions/:id - Atualizar transação
router.put('/:id', transactionValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transação não encontrada'
      });
    }

    const oldCategoryId = transaction.categoryId;
    const oldType = transaction.type;

    // Verificar nova categoria se fornecida
    if (req.body.categoryId && req.body.categoryId !== transaction.categoryId?.toString()) {
      const category = await Category.findOne({
        _id: req.body.categoryId,
        userId: req.userId,
        isActive: true
      });

      if (!category) {
        return res.status(400).json({
          success: false,
          message: 'Categoria não encontrada'
        });
      }

      if (category.type !== 'both' && category.type !== (req.body.type || transaction.type)) {
        return res.status(400).json({
          success: false,
          message: 'Tipo de transação incompatível com a categoria'
        });
      }
    }

    // Atualizar campos
    Object.assign(transaction, req.body);
    await transaction.save();

    // Atualizar orçamentos se necessário
    if (oldType === 'expense' || transaction.type === 'expense') {
      if (oldCategoryId) {
        await updateBudgetSpent(oldCategoryId, req.userId);
      }
      if (transaction.categoryId && transaction.type === 'expense') {
        await updateBudgetSpent(transaction.categoryId, req.userId);
      }
    }

    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('categoryId', 'name icon color');

    res.json({
      success: true,
      message: 'Transação atualizada com sucesso',
      data: { transaction: populatedTransaction }
    });

  } catch (error) {
    console.error('Erro ao atualizar transação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// DELETE /api/transactions/:id - Deletar transação
router.delete('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transação não encontrada'
      });
    }

    // Soft delete
    await transaction.softDelete();

    // Atualizar orçamento se for gasto
    if (transaction.type === 'expense' && transaction.categoryId) {
      await updateBudgetSpent(transaction.categoryId, req.userId);
    }

    res.json({
      success: true,
      message: 'Transação deletada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar transação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/transactions/:id/restore - Restaurar transação
router.post('/:id/restore', async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.userId,
      isDeleted: true
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transação não encontrada'
      });
    }

    await transaction.restore();

    // Atualizar orçamento se for gasto
    if (transaction.type === 'expense' && transaction.categoryId) {
      await updateBudgetSpent(transaction.categoryId, req.userId);
    }

    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('categoryId', 'name icon color');

    res.json({
      success: true,
      message: 'Transação restaurada com sucesso',
      data: { transaction: populatedTransaction }
    });

  } catch (error) {
    console.error('Erro ao restaurar transação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// Função auxiliar para atualizar gastos do orçamento
async function updateBudgetSpent(categoryId, userId) {
  try {
    const activeBudgets = await Budget.find({
      categoryId,
      userId,
      isActive: true,
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() }
    });

    for (const budget of activeBudgets) {
      await budget.calculateSpent();
      await budget.save();
    }
  } catch (error) {
    console.error('Erro ao atualizar orçamento:', error);
  }
}

module.exports = router;
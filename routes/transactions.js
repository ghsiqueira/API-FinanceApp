// routes/transactions.js - Versão Completa Corrigida
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Verificar se o middleware foi carregado corretamente
if (!authenticate) {
  console.error('❌ Middleware authenticate não foi carregado corretamente');
  throw new Error('Middleware authenticate não encontrado');
}

// Aplicar autenticação em todas as rotas
router.use(authenticate);

// 🔥 MELHORADO: Validações com suporte a recorrência
const transactionValidation = [
  body('description')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Descrição é obrigatória e deve ter no máximo 100 caracteres'),
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Valor deve ser maior que zero'),
  body('type')
    .isIn(['income', 'expense'])
    .withMessage('Tipo deve ser income ou expense'),
  body('categoryId')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('ID da categoria inválido'),
  body('date')
    .optional()
    .isISO8601()
    .withMessage('Data inválida'),
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notas devem ter no máximo 500 caracteres'),
  body('paymentMethod')
    .optional()
    .isIn(['cash', 'credit_card', 'debit_card', 'bank_transfer', 'pix', 'other'])
    .withMessage('Método de pagamento inválido'),
  
  // 🔥 NOVO: Validações para recorrência
  body('isRecurring')
    .optional()
    .isBoolean()
    .withMessage('isRecurring deve ser boolean'),
  body('recurringConfig.frequency')
    .if(body('isRecurring').equals(true))
    .isIn(['daily', 'weekly', 'monthly', 'yearly'])
    .withMessage('Frequência de recorrência inválida'),
  body('recurringConfig.interval')
    .if(body('isRecurring').equals(true))
    .isInt({ min: 1, max: 99 })
    .withMessage('Intervalo deve ser entre 1 e 99'),
  body('recurringConfig.endDate')
    .optional({ nullable: true })
    .isISO8601()
    .withMessage('Data de fim da recorrência inválida'),
  body('recurringConfig.remainingOccurrences')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('Número de ocorrências deve ser positivo')
];

// Função auxiliar para atualizar gastos do orçamento
const updateBudgetSpent = async (categoryId, userId) => {
  try {
    const Budget = require('../models/Budget');
    const now = new Date();
    
    const activeBudgets = await Budget.find({
      userId,
      categoryId,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });

    for (const budget of activeBudgets) {
      await budget.updateSpentAmount();
    }
  } catch (error) {
    console.error('Erro ao atualizar orçamento:', error);
  }
};

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

    // 🔥 MELHORADO: Verificar categoria apenas se fornecida (opcional)
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

      // Verificar compatibilidade de tipo
      if (category.type !== 'both' && category.type !== transactionData.type) {
        return res.status(400).json({
          success: false,
          message: `Categoria "${category.name}" não aceita transações do tipo "${transactionData.type}"`
        });
      }
    }

    // 🔥 NOVO: Validar configuração de recorrência
    if (transactionData.isRecurring) {
      if (!transactionData.recurringConfig || !transactionData.recurringConfig.frequency) {
        return res.status(400).json({
          success: false,
          message: 'Configuração de recorrência é obrigatória para transações recorrentes'
        });
      }

      // Validar data de fim ou número de ocorrências
      if (!transactionData.recurringConfig.endDate && !transactionData.recurringConfig.remainingOccurrences) {
        return res.status(400).json({
          success: false,
          message: 'Data de fim ou número de ocorrências é obrigatório para recorrência'
        });
      }
    }

    // Criar transação
    const transaction = new Transaction(transactionData);
    await transaction.save();

    // Popular categoria para resposta
    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('categoryId', 'name icon color type');

    // Atualizar orçamentos se for gasto
    if (transaction.type === 'expense' && transaction.categoryId) {
      await updateBudgetSpent(transaction.categoryId, req.userId);
    }

    res.status(201).json({
      success: true,
      message: `Transação${transaction.isRecurring ? ' recorrente' : ''} criada com sucesso`,
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

// GET /api/transactions - Listar transações
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Página deve ser um número positivo'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limite deve ser entre 1 e 100'),
  query('type').optional().isIn(['income', 'expense']).withMessage('Tipo inválido'),
  query('categoryId').optional().isMongoId().withMessage('ID da categoria inválido'),
  query('startDate').optional().isISO8601().withMessage('Data inicial inválida'),
  query('endDate').optional().isISO8601().withMessage('Data final inválida'),
  query('search').optional().isLength({ max: 100 }).withMessage('Busca muito longa'),
  // 🔥 NOVO: Filtros para recorrência
  query('isRecurring').optional().isBoolean().withMessage('isRecurring deve ser boolean'),
  query('includeGenerated').optional().isBoolean().withMessage('includeGenerated deve ser boolean')
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
      search,
      isRecurring,
      includeGenerated = true
    } = req.query;

    // Construir filtros
    const filters = { 
      userId: req.userId,
      isDeleted: { $ne: true }
    };

    if (type) filters.type = type;
    if (categoryId) filters.categoryId = categoryId;
    if (isRecurring !== undefined) filters.isRecurring = isRecurring;
    
    // 🔥 NOVO: Filtrar transações geradas por recorrência
    if (!includeGenerated) {
      filters.isGeneratedFromRecurring = { $ne: true };
    }

    // Filtros de data
    if (startDate || endDate) {
      filters.date = {};
      if (startDate) filters.date.$gte = new Date(startDate);
      if (endDate) filters.date.$lte = new Date(endDate);
    }

    // Busca por texto
    if (search) {
      filters.$or = [
        { description: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }

    // Executar query com paginação
    const skip = (page - 1) * limit;
    
    const [transactions, totalItems] = await Promise.all([
      Transaction.find(filters)
        .populate('categoryId', 'name icon color type')
        .populate('parentTransactionId', 'description date')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Transaction.countDocuments(filters)
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    res.json({
      success: true,
      data: {
        items: transactions,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems,
          itemsPerPage: parseInt(limit),
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
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

// GET /api/transactions/:id - Buscar transação específica
router.get('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.userId,
      isDeleted: { $ne: true }
    })
    .populate('categoryId', 'name icon color type')
    .populate('parentTransactionId', 'description date isRecurring');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transação não encontrada'
      });
    }

    // 🔥 NOVO: Incluir transações filhas se for recorrente
    let childTransactions = [];
    if (transaction.isRecurring) {
      childTransactions = await Transaction.find({
        parentTransactionId: transaction._id,
        isDeleted: { $ne: true }
      })
      .populate('categoryId', 'name icon color')
      .sort({ date: 1 })
      .limit(10); // Limitar para não sobrecarregar
    }

    res.json({
      success: true,
      data: { 
        transaction,
        childTransactions: childTransactions.length > 0 ? childTransactions : undefined
      }
    });

  } catch (error) {
    console.error('Erro ao buscar transação:', error);
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
      userId: req.userId,
      isDeleted: { $ne: true }
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

    // 🔥 NOVO: Atualizar configuração de recorrência
    if (req.body.isRecurring !== undefined) {
      if (req.body.isRecurring && (!req.body.recurringConfig || !req.body.recurringConfig.frequency)) {
        return res.status(400).json({
          success: false,
          message: 'Configuração de recorrência é obrigatória'
        });
      }
    }

    // Atualizar campos
    Object.assign(transaction, req.body);
    transaction.version += 1; // Incrementar versão para sync
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
      userId: req.userId,
      isDeleted: { $ne: true }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transação não encontrada'
      });
    }

    // 🔥 NOVO: Se for transação recorrente, perguntar sobre transações filhas
    const childCount = await Transaction.countDocuments({
      parentTransactionId: transaction._id,
      isDeleted: { $ne: true }
    });

    // Soft delete da transação
    transaction.isDeleted = true;
    transaction.deletedAt = new Date();
    transaction.version += 1;
    await transaction.save();

    // 🔥 NOVO: Opcionalmente deletar transações filhas (para implementar no frontend)
    if (req.query.deleteChildren === 'true' && childCount > 0) {
      await Transaction.updateMany(
        { parentTransactionId: transaction._id },
        { 
          isDeleted: true, 
          deletedAt: new Date(),
          $inc: { version: 1 }
        }
      );
    }

    // Atualizar orçamentos se for gasto
    if (transaction.type === 'expense' && transaction.categoryId) {
      await updateBudgetSpent(transaction.categoryId, req.userId);
    }

    res.json({
      success: true,
      message: 'Transação deletada com sucesso',
      data: { 
        deletedCount: 1 + (req.query.deleteChildren === 'true' ? childCount : 0)
      }
    });

  } catch (error) {
    console.error('Erro ao deletar transação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// 🔥 NOVO: POST /api/transactions/process-recurring - Processar transações recorrentes
router.post('/process-recurring', async (req, res) => {
  try {
    const newTransactions = await Transaction.processRecurringTransactions();
    
    res.json({
      success: true,
      message: `${newTransactions.length} transações recorrentes processadas`,
      data: { 
        count: newTransactions.length,
        transactions: newTransactions
      }
    });

  } catch (error) {
    console.error('Erro ao processar transações recorrentes:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// 🔥 NOVO: GET /api/transactions/recurring/stats - Estatísticas de recorrência
router.get('/recurring/stats', async (req, res) => {
  try {
    const stats = await Transaction.getRecurringStats(req.userId);
    
    const totalRecurring = await Transaction.countDocuments({
      userId: req.userId,
      isRecurring: true,
      isDeleted: { $ne: true }
    });

    res.json({
      success: true,
      data: {
        totalRecurring,
        byFrequency: stats
      }
    });

  } catch (error) {
    console.error('Erro ao buscar estatísticas de recorrência:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// 🔥 MELHORADO: GET /api/transactions/stats - Estatísticas das transações
router.get('/stats', [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('groupBy').optional().isIn(['day', 'week', 'month', 'year'])
], async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'month' } = req.query;

    // Filtros base
    const matchFilters = {
      userId: req.userId,
      isDeleted: { $ne: true }
    };

    if (startDate || endDate) {
      matchFilters.date = {};
      if (startDate) matchFilters.date.$gte = new Date(startDate);
      if (endDate) matchFilters.date.$lte = new Date(endDate);
    }

    // Configurar agrupamento por período
    let dateGrouping;
    switch (groupBy) {
      case 'day':
        dateGrouping = {
          year: { $year: '$date' },
          month: { $month: '$date' },
          day: { $dayOfMonth: '$date' }
        };
        break;
      case 'week':
        dateGrouping = {
          year: { $year: '$date' },
          week: { $week: '$date' }
        };
        break;
      case 'year':
        dateGrouping = {
          year: { $year: '$date' }
        };
        break;
      default: // month
        dateGrouping = {
          year: { $year: '$date' },
          month: { $month: '$date' }
        };
    }

    // 🔥 MELHORADO: Aggregation pipeline para estatísticas completas
    const [stats, categoryStats, summary] = await Promise.all([
      // Estatísticas por período
      Transaction.aggregate([
        { $match: matchFilters },
        {
          $group: {
            _id: {
              period: dateGrouping,
              type: '$type'
            },
            total: { $sum: '$amount' },
            count: { $sum: 1 },
            avgAmount: { $avg: '$amount' }
          }
        },
        {
          $group: {
            _id: '$_id.period',
            data: {
              $push: {
                type: '$_id.type',
                total: { $round: ['$total', 2] },
                count: '$count',
                avgAmount: { $round: ['$avgAmount', 2] }
              }
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.week': 1, '_id.day': 1 } }
      ]),

      // Estatísticas por categoria
      Transaction.aggregate([
        { $match: matchFilters },
        {
          $lookup: {
            from: 'categories',
            localField: 'categoryId',
            foreignField: '_id',
            as: 'category'
          }
        },
        {
          $group: {
            _id: {
              categoryId: '$categoryId',
              type: '$type'
            },
            category: { $first: { $arrayElemAt: ['$category', 0] } },
            total: { $sum: '$amount' },
            count: { $sum: 1 },
            avgAmount: { $avg: '$amount' }
          }
        },
        {
          $project: {
            categoryId: '$_id.categoryId',
            type: '$_id.type',
            category: {
              $ifNull: [
                '$category',
                { name: 'Sem categoria', icon: 'help-circle', color: '#A8A8A8' }
              ]
            },
            total: { $round: ['$total', 2] },
            count: 1,
            avgAmount: { $round: ['$avgAmount', 2] }
          }
        },
        { $sort: { total: -1 } }
      ]),

      // Resumo geral
      Transaction.aggregate([
        { $match: matchFilters },
        {
          $group: {
            _id: '$type',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
            avgAmount: { $avg: '$amount' }
          }
        }
      ])
    ]);

    // Processar resumo
    const summaryData = {
      income: { total: 0, count: 0, avgAmount: 0 },
      expense: { total: 0, count: 0, avgAmount: 0 }
    };

    summary.forEach(item => {
      summaryData[item._id] = {
        total: Math.round(item.total * 100) / 100,
        count: item.count,
        avgAmount: Math.round(item.avgAmount * 100) / 100
      };
    });

    summaryData.balance = summaryData.income.total - summaryData.expense.total;

    // Calcular percentuais para categorias
    const totalByType = {
      income: categoryStats.filter(s => s.type === 'income').reduce((sum, s) => sum + s.total, 0),
      expense: categoryStats.filter(s => s.type === 'expense').reduce((sum, s) => sum + s.total, 0)
    };

    const categoryStatsWithPercentage = categoryStats.map(stat => ({
      ...stat,
      percentage: totalByType[stat.type] > 0 
        ? Math.round((stat.total / totalByType[stat.type]) * 100 * 100) / 100
        : 0
    }));

    res.json({
      success: true,
      data: {
        summary: summaryData,
        timeline: stats,
        categories: categoryStatsWithPercentage,
        period: { groupBy, startDate, endDate }
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

// POST /api/transactions/bulk - Criar múltiplas transações
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
        message: 'Máximo 100 transações por vez'
      });
    }

    const validTransactions = [];
    const errors = [];

    // Validar cada transação
    for (let i = 0; i < transactions.length; i++) {
      const trans = transactions[i];

      if (!trans.description || !trans.amount || !trans.type) {
        errors.push(`Transação ${i + 1}: campos obrigatórios ausentes`);
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

module.exports = router;
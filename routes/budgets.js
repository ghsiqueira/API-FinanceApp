const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Budget = require('../models/Budget');
const Category = require('../models/Category');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticação em todas as rotas
router.use(authenticate);

// Validações
const budgetValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Nome deve ter entre 1 e 50 caracteres'),
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Valor deve ser maior que zero'),
  body('categoryId')
    .isMongoId()
    .withMessage('ID da categoria inválido'),
  body('period')
    .optional()
    .isIn(['weekly', 'monthly', 'quarterly', 'yearly'])
    .withMessage('Período deve ser weekly, monthly, quarterly ou yearly'),
  body('startDate')
    .isISO8601()
    .withMessage('Data de início inválida'),
  body('endDate')
    .isISO8601()
    .withMessage('Data de fim inválida'),
  body('alertThreshold')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Limite de alerta deve ser entre 0 e 100'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Notas devem ter no máximo 200 caracteres'),
  body('color')
    .optional()
    .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .withMessage('Cor deve estar no formato hexadecimal')
];

// GET /api/budgets/summary - Resumo dos orçamentos (ANTES das rotas com parâmetros)
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();

    // Orçamentos ativos
    const activeBudgets = await Budget.find({
      userId: req.userId,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    }).populate('categoryId', 'name icon color');

    // Calcular totais
    let totalBudget = 0;
    let totalSpent = 0;
    let budgetsExceeded = 0;
    let budgetsNearLimit = 0;

    for (const budget of activeBudgets) {
      await budget.calculateSpent();
      await budget.save();

      totalBudget += budget.amount;
      totalSpent += budget.spent;

      if (budget.isExceeded) {
        budgetsExceeded++;
      } else if (budget.spentPercentage >= budget.alertThreshold) {
        budgetsNearLimit++;
      }
    }

    // Últimas transações que afetaram orçamentos
    const budgetCategoryIds = activeBudgets.map(b => b.categoryId._id);
    
    const Transaction = require('../models/Transaction');
    const recentTransactions = await Transaction.find({
      userId: req.userId,
      type: 'expense',
      categoryId: { $in: budgetCategoryIds },
      isDeleted: { $ne: true },
      status: 'completed'
    })
      .populate('categoryId', 'name icon color')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        summary: {
          totalBudget,
          totalSpent,
          totalRemaining: Math.max(0, totalBudget - totalSpent),
          overallPercentage: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
          activeBudgetsCount: activeBudgets.length,
          budgetsExceeded,
          budgetsNearLimit
        },
        activeBudgets,
        recentTransactions
      }
    });

  } catch (error) {
    console.error('Erro ao buscar resumo dos orçamentos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/budgets/alerts - Buscar orçamentos que precisam de alerta (ANTES das rotas com parâmetros)
router.get('/alerts', async (req, res) => {
  try {
    const budgetsNeedingAlert = await Budget.find({
      userId: req.userId,
      isActive: true,
      alertSent: false,
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() }
    }).populate('categoryId', 'name icon color');

    const alerts = [];

    for (const budget of budgetsNeedingAlert) {
      await budget.calculateSpent();
      
      if (budget.shouldAlert) {
        alerts.push({
          budgetId: budget._id,
          budgetName: budget.name,
          category: budget.categoryId,
          spent: budget.spent,
          limit: budget.amount,
          percentage: budget.spentPercentage,
          isExceeded: budget.isExceeded
        });

        // Marcar como alerta enviado
        budget.alertSent = true;
        await budget.save();
      }
    }

    res.json({
      success: true,
      data: { alerts }
    });

  } catch (error) {
    console.error('Erro ao buscar alertas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/budgets - Listar orçamentos
router.get('/', async (req, res) => {
  try {
    const { status, period, includeInactive } = req.query;

    const filters = { userId: req.userId };

    if (period && ['weekly', 'monthly', 'quarterly', 'yearly'].includes(period)) {
      filters.period = period;
    }

    if (!includeInactive) {
      filters.isActive = true;
    }

    // Filtrar por status (active, expired, future)
    const now = new Date();
    if (status === 'active') {
      filters.startDate = { $lte: now };
      filters.endDate = { $gte: now };
    } else if (status === 'expired') {
      filters.endDate = { $lt: now };
    } else if (status === 'future') {
      filters.startDate = { $gt: now };
    }

    const budgets = await Budget.find(filters)
      .populate('categoryId', 'name icon color type')
      .sort({ startDate: -1 });

    // Calcular gastos atuais para cada orçamento
    for (const budget of budgets) {
      await budget.calculateSpent();
      await budget.save();
    }

    res.json({
      success: true,
      data: { budgets }
    });

  } catch (error) {
    console.error('Erro ao listar orçamentos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/budgets/:id - Buscar orçamento específico (DEPOIS das rotas específicas)
router.get('/:id', async (req, res) => {
  try {
    const budget = await Budget.findOne({
      _id: req.params.id,
      userId: req.userId
    }).populate('categoryId', 'name icon color type');

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    // Atualizar valor gasto
    await budget.calculateSpent();
    await budget.save();

    // Buscar histórico de gastos do período
    const Transaction = require('../models/Transaction');
    const transactions = await Transaction.find({
      userId: req.userId,
      categoryId: budget.categoryId._id,
      type: 'expense',
      status: 'completed',
      isDeleted: { $ne: true },
      date: {
        $gte: budget.startDate,
        $lte: budget.endDate
      }
    }).sort({ date: -1 });

    // Calcular gastos por dia para gráfico
    const dailySpending = {};
    transactions.forEach(transaction => {
      const date = transaction.date.toISOString().split('T')[0];
      dailySpending[date] = (dailySpending[date] || 0) + transaction.amount;
    });

    res.json({
      success: true,
      data: {
        budget,
        transactions,
        dailySpending
      }
    });

  } catch (error) {
    console.error('Erro ao buscar orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/budgets - Criar orçamento
router.post('/', budgetValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { categoryId, startDate, endDate } = req.body;

    // Verificar se categoria existe e pertence ao usuário
    const category = await Category.findOne({
      _id: categoryId,
      userId: req.userId,
      isActive: true
    });

    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Categoria não encontrada'
      });
    }

    // Verificar se categoria é compatível com gastos
    if (category.type === 'income') {
      return res.status(400).json({
        success: false,
        message: 'Não é possível criar orçamento para categoria de receita'
      });
    }

    // Verificar se já existe orçamento ativo para esta categoria no período
    const existingBudget = await Budget.findOne({
      userId: req.userId,
      categoryId,
      isActive: true,
      $or: [
        {
          startDate: { $lte: new Date(endDate) },
          endDate: { $gte: new Date(startDate) }
        }
      ]
    });

    if (existingBudget) {
      return res.status(400).json({
        success: false,
        message: 'Já existe um orçamento ativo para esta categoria no período especificado'
      });
    }

    const budget = new Budget({
      ...req.body,
      userId: req.userId
    });

    // Calcular gasto atual
    await budget.calculateSpent();
    await budget.save();

    const populatedBudget = await Budget.findById(budget._id)
      .populate('categoryId', 'name icon color type');

    res.status(201).json({
      success: true,
      message: 'Orçamento criado com sucesso',
      data: { budget: populatedBudget }
    });

  } catch (error) {
    console.error('Erro ao criar orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/budgets/:id - Atualizar orçamento
router.put('/:id', budgetValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const budget = await Budget.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    // Se mudou a categoria, verificar se é válida
    if (req.body.categoryId && req.body.categoryId !== budget.categoryId.toString()) {
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

      if (category.type === 'income') {
        return res.status(400).json({
          success: false,
          message: 'Não é possível usar categoria de receita'
        });
      }

      // Verificar conflito com outros orçamentos
      const { startDate = budget.startDate, endDate = budget.endDate } = req.body;
      
      const conflictingBudget = await Budget.findOne({
        userId: req.userId,
        categoryId: req.body.categoryId,
        isActive: true,
        _id: { $ne: budget._id },
        $or: [
          {
            startDate: { $lte: new Date(endDate) },
            endDate: { $gte: new Date(startDate) }
          }
        ]
      });

      if (conflictingBudget) {
        return res.status(400).json({
          success: false,
          message: 'Já existe um orçamento ativo para esta categoria no período especificado'
        });
      }
    }

    // Atualizar campos
    Object.assign(budget, req.body);
    
    // Recalcular gasto se mudou categoria ou período
    if (req.body.categoryId || req.body.startDate || req.body.endDate) {
      await budget.calculateSpent();
    }

    await budget.save();

    const populatedBudget = await Budget.findById(budget._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: 'Orçamento atualizado com sucesso',
      data: { budget: populatedBudget }
    });

  } catch (error) {
    console.error('Erro ao atualizar orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// DELETE /api/budgets/:id - Deletar orçamento
router.delete('/:id', async (req, res) => {
  try {
    const budget = await Budget.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    await Budget.findByIdAndDelete(budget._id);

    res.json({
      success: true,
      message: 'Orçamento deletado com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/budgets/:id/toggle - Ativar/desativar orçamento
router.post('/:id/toggle', async (req, res) => {
  try {
    const budget = await Budget.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    budget.isActive = !budget.isActive;
    await budget.save();

    const populatedBudget = await Budget.findById(budget._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: `Orçamento ${budget.isActive ? 'ativado' : 'desativado'} com sucesso`,
      data: { budget: populatedBudget }
    });

  } catch (error) {
    console.error('Erro ao alternar orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/budgets/:id/renew - Renovar orçamento
router.post('/:id/renew', async (req, res) => {
  try {
    const budget = await Budget.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    if (budget.autoRenew) {
      await budget.renew();
    } else {
      // Renovação manual - criar novo orçamento
      const duration = budget.endDate - budget.startDate;
      const newBudget = new Budget({
        name: budget.name,
        amount: budget.amount,
        categoryId: budget.categoryId,
        userId: req.userId,
        period: budget.period,
        startDate: new Date(),
        endDate: new Date(Date.now() + duration),
        alertThreshold: budget.alertThreshold,
        notes: budget.notes,
        color: budget.color,
        autoRenew: budget.autoRenew
      });

      await newBudget.calculateSpent();
      await newBudget.save();

      // Desativar orçamento anterior
      budget.isActive = false;
      await budget.save();
    }

    const populatedBudget = await Budget.findById(budget._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: 'Orçamento renovado com sucesso',
      data: { budget: populatedBudget }
    });

  } catch (error) {
    console.error('Erro ao renovar orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
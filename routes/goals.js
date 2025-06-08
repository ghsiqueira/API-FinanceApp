const express = require('express');
const { body, validationResult } = require('express-validator');
const Goal = require('../models/Goal');
const Category = require('../models/Category');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticação em todas as rotas
router.use(authenticate);

// Validações
const goalValidation = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Título deve ter entre 1 e 50 caracteres'),
  body('targetAmount')
    .isFloat({ min: 0.01 })
    .withMessage('Valor da meta deve ser maior que zero'),
  body('targetDate')
    .isISO8601()
    .withMessage('Data da meta inválida')
    .custom((value) => {
      if (new Date(value) <= new Date()) {
        throw new Error('Data da meta deve ser futura');
      }
      return true;
    }),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Descrição deve ter no máximo 200 caracteres'),
  body('categoryId')
    .optional()
    .isMongoId()
    .withMessage('ID da categoria inválido'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Prioridade deve ser low, medium ou high'),
  body('color')
    .optional()
    .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .withMessage('Cor deve estar no formato hexadecimal')
];

const contributionValidation = [
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Valor da contribuição deve ser maior que zero'),
  body('note')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Nota deve ter no máximo 100 caracteres')
];

const reminderValidation = [
  body('message')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Mensagem deve ter entre 1 e 100 caracteres'),
  body('date')
    .isISO8601()
    .withMessage('Data inválida')
    .custom((value) => {
      if (new Date(value) <= new Date()) {
        throw new Error('Data do lembrete deve ser futura');
      }
      return true;
    })
];

// GET /api/goals/summary - Resumo das metas (ANTES de /:id)
router.get('/summary', async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.userId });

    const summary = {
      total: goals.length,
      active: goals.filter(g => g.status === 'active').length,
      completed: goals.filter(g => g.status === 'completed').length,
      paused: goals.filter(g => g.status === 'paused').length,
      cancelled: goals.filter(g => g.status === 'cancelled').length,
      totalTargetAmount: goals.reduce((sum, g) => sum + g.targetAmount, 0),
      totalCurrentAmount: goals.reduce((sum, g) => sum + g.currentAmount, 0),
      totalProgress: 0
    };

    if (summary.totalTargetAmount > 0) {
      summary.totalProgress = Math.round((summary.totalCurrentAmount / summary.totalTargetAmount) * 100);
    }

    // Metas próximas do prazo (próximas 30 dias)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const upcomingGoals = goals.filter(goal => 
      goal.status === 'active' && 
      new Date(goal.targetDate) <= thirtyDaysFromNow
    ).sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate));

    // Metas recentemente completadas
    const recentlyCompleted = goals
      .filter(goal => goal.status === 'completed')
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 5);

    res.json({
      success: true,
      data: {
        summary,
        upcomingGoals,
        recentlyCompleted
      }
    });

  } catch (error) {
    console.error('Erro ao buscar resumo das metas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/goals - Listar metas
router.get('/', async (req, res) => {
  try {
    const { status, priority, includeCompleted } = req.query;

    const filters = { userId: req.userId };

    if (status && ['active', 'completed', 'paused', 'cancelled'].includes(status)) {
      filters.status = status;
    } else if (!includeCompleted) {
      filters.status = { $ne: 'completed' };
    }

    if (priority && ['low', 'medium', 'high'].includes(priority)) {
      filters.priority = priority;
    }

    const goals = await Goal.find(filters)
      .populate('categoryId', 'name icon color type')
      .sort({ priority: -1, targetDate: 1 });

    res.json({
      success: true,
      data: { goals }
    });

  } catch (error) {
    console.error('Erro ao listar metas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/goals/:id - Buscar meta específica (DEPOIS das rotas específicas)
router.get('/:id', async (req, res) => {
  try {
    const goal = await Goal.findOne({
      _id: req.params.id,
      userId: req.userId
    }).populate('categoryId', 'name icon color type');

    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Meta não encontrada'
      });
    }

    // Calcular estatísticas das contribuições
    const contributionStats = {
      total: goal.contributions.length,
      automatic: goal.contributions.filter(c => c.isAutomatic).length,
      manual: goal.contributions.filter(c => !c.isAutomatic).length,
      averageAmount: 0,
      lastContribution: null
    };

    if (goal.contributions.length > 0) {
      contributionStats.averageAmount = goal.contributions.reduce((sum, c) => sum + c.amount, 0) / goal.contributions.length;
      contributionStats.lastContribution = goal.contributions
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    }

    res.json({
      success: true,
      data: {
        goal,
        contributionStats
      }
    });

  } catch (error) {
    console.error('Erro ao buscar meta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/goals - Criar meta
router.post('/', goalValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    // Verificar categoria se fornecida
    if (req.body.categoryId) {
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
    }

    const goal = new Goal({
      ...req.body,
      userId: req.userId
    });

    await goal.save();

    const populatedGoal = await Goal.findById(goal._id)
      .populate('categoryId', 'name icon color type');

    res.status(201).json({
      success: true,
      message: 'Meta criada com sucesso',
      data: { goal: populatedGoal }
    });

  } catch (error) {
    console.error('Erro ao criar meta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/goals/:id - Atualizar meta
router.put('/:id', goalValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const goal = await Goal.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Meta não encontrada'
      });
    }

    // Verificar categoria se fornecida
    if (req.body.categoryId && req.body.categoryId !== goal.categoryId?.toString()) {
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
    }

    // Não permitir alterar metas completadas
    if (goal.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Não é possível alterar metas completadas'
      });
    }

    Object.assign(goal, req.body);
    await goal.save();

    const populatedGoal = await Goal.findById(goal._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: 'Meta atualizada com sucesso',
      data: { goal: populatedGoal }
    });

  } catch (error) {
    console.error('Erro ao atualizar meta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// DELETE /api/goals/:id - Deletar meta
router.delete('/:id', async (req, res) => {
  try {
    const goal = await Goal.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Meta não encontrada'
      });
    }

    await Goal.findByIdAndDelete(goal._id);

    res.json({
      success: true,
      message: 'Meta deletada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar meta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/goals/:id/contribute - Adicionar contribuição
router.post('/:id/contribute', contributionValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const goal = await Goal.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Meta não encontrada'
      });
    }

    const { amount, note = '' } = req.body;

    await goal.addContribution(amount, note, false);

    const populatedGoal = await Goal.findById(goal._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: goal.status === 'completed' ? 'Contribuição adicionada e meta completada! 🎉' : 'Contribuição adicionada com sucesso',
      data: { goal: populatedGoal }
    });

  } catch (error) {
    console.error('Erro ao adicionar contribuição:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

// DELETE /api/goals/:id/contributions/:contributionId - Remover contribuição
router.delete('/:id/contributions/:contributionId', async (req, res) => {
  try {
    const goal = await Goal.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Meta não encontrada'
      });
    }

    await goal.removeContribution(req.params.contributionId);

    const populatedGoal = await Goal.findById(goal._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: 'Contribuição removida com sucesso',
      data: { goal: populatedGoal }
    });

  } catch (error) {
    console.error('Erro ao remover contribuição:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

// POST /api/goals/:id/reminders - Adicionar lembrete
router.post('/:id/reminders', reminderValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const goal = await Goal.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Meta não encontrada'
      });
    }

    const { message, date } = req.body;

    await goal.addReminder(message, date);

    const populatedGoal = await Goal.findById(goal._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: 'Lembrete adicionado com sucesso',
      data: { goal: populatedGoal }
    });

  } catch (error) {
    console.error('Erro ao adicionar lembrete:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

// DELETE /api/goals/:id/reminders/:reminderId - Remover lembrete
router.delete('/:id/reminders/:reminderId', async (req, res) => {
  try {
    const goal = await Goal.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Meta não encontrada'
      });
    }

    goal.reminders.pull(req.params.reminderId);
    await goal.save();

    const populatedGoal = await Goal.findById(goal._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: 'Lembrete removido com sucesso',
      data: { goal: populatedGoal }
    });

  } catch (error) {
    console.error('Erro ao remover lembrete:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/goals/:id/status - Alterar status da meta
router.post('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    if (!['active', 'completed', 'paused', 'cancelled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status inválido'
      });
    }

    const goal = await Goal.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!goal) {
      return res.status(404).json({
        success: false,
        message: 'Meta não encontrada'
      });
    }

    const oldStatus = goal.status;
    goal.status = status;

    if (status === 'completed' && oldStatus !== 'completed') {
      goal.completedAt = new Date();
    } else if (status !== 'completed') {
      goal.completedAt = null;
    }

    await goal.save();

    const populatedGoal = await Goal.findById(goal._id)
      .populate('categoryId', 'name icon color type');

    res.json({
      success: true,
      message: `Status da meta alterado para ${status}`,
      data: { goal: populatedGoal }
    });

  } catch (error) {
    console.error('Erro ao alterar status da meta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
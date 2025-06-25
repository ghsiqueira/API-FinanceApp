const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Budget = require('../models/Budget');
const Goal = require('../models/Goal');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticação em todas as rotas
router.use(authenticate);

// Validações
const updateProfileValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Nome deve ter entre 2 e 50 caracteres'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Email inválido'),
  body('currency')
    .optional()
    .isLength({ min: 3, max: 3 })
    .withMessage('Código da moeda deve ter 3 caracteres'),
  body('theme')
    .optional()
    .isIn(['light', 'dark'])
    .withMessage('Tema deve ser light ou dark')
];

const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Senha atual é obrigatória'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('Nova senha deve ter no mínimo 6 caracteres'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Confirmação de senha não confere');
      }
      return true;
    })
];

// GET /api/user/profile - Buscar perfil do usuário
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/user/profile - Atualizar perfil
router.put('/profile', updateProfileValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Verificar se email já está em uso (se mudou)
    if (req.body.email && req.body.email !== user.email) {
      const existingUser = await User.findOne({
        email: req.body.email,
        _id: { $ne: user._id }
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email já está em uso'
        });
      }

      // Se mudou o email, precisa verificar novamente
      user.isEmailVerified = false;
      user.emailVerificationToken = null;
      user.emailVerificationExpires = null;
    }

    // Atualizar campos permitidos
    const allowedFields = ['name', 'email', 'currency', 'theme', 'avatar'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        user[field] = req.body[field];
      }
    });

    await user.save();

    res.json({
      success: true,
      message: 'Perfil atualizado com sucesso',
      data: { user }
    });

  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/user/preferences - Atualizar preferências
router.put('/preferences', async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Merge das preferências
    if (req.body.preferences) {
      user.preferences = {
        ...user.preferences,
        ...req.body.preferences
      };
    }

    await user.save();

    res.json({
      success: true,
      message: 'Preferências atualizadas com sucesso',
      data: { 
        preferences: user.preferences 
      }
    });

  } catch (error) {
    console.error('Erro ao atualizar preferências:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/user/change-password - Alterar senha
router.post('/change-password', changePasswordValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Verificar senha atual
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Senha atual incorreta'
      });
    }

    // Atualizar senha
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Senha alterada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/user/dashboard - Dashboard do usuário
router.get('/dashboard', async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    // ✅ CORRIGIDO: Calcular datas do período
    const now = new Date();
    let startDate, endDate;

    switch (period) {
      case 'week':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        endDate = now;
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0); // ✅ CORRIGIDO
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    console.log(`📊 Buscando dashboard para usuário ${req.userId}, período: ${period}`);
    console.log(`📅 Datas: ${startDate.toISOString()} até ${endDate.toISOString()}`);

    // ✅ CORRIGIDO: Buscar dados com tratamento de erro individual
    let financialStats = null;
    let activeBudgets = [];
    let activeGoals = [];
    let recentTransactions = [];
    let categorySpending = [];
    let monthlyEvolution = [];

    try {
      // Estatísticas financeiras básicas
      const transactions = await Transaction.find({
        userId: req.userId,
        date: { $gte: startDate, $lte: endDate },
        isDeleted: { $ne: true },
        status: 'completed'
      });

      const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
      const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

      financialStats = {
        income,
        expense,
        balance: income - expense,
        incomeCount: transactions.filter(t => t.type === 'income').length,
        expenseCount: transactions.filter(t => t.type === 'expense').length,
        totalTransactions: transactions.length
      };

      console.log('✅ Estatísticas financeiras calculadas');
    } catch (error) {
      console.error('❌ Erro nas estatísticas financeiras:', error);
    }

    try {
      // Orçamentos ativos
      activeBudgets = await Budget.find({
        userId: req.userId,
        isActive: true,
        startDate: { $lte: endDate },
        endDate: { $gte: startDate }
      }).populate('categoryId').limit(5);

      console.log(`✅ ${activeBudgets.length} orçamentos ativos encontrados`);
    } catch (error) {
      console.error('❌ Erro ao buscar orçamentos:', error);
    }

    try {
      // Metas ativas
      activeGoals = await Goal.find({
        userId: req.userId,
        status: 'active'
      }).populate('categoryId').limit(5);

      console.log(`✅ ${activeGoals.length} metas ativas encontradas`);
    } catch (error) {
      console.error('❌ Erro ao buscar metas:', error);
    }

    try {
      // Transações recentes
      recentTransactions = await Transaction.find({
        userId: req.userId,
        isDeleted: { $ne: true }
      })
      .populate('categoryId')
      .sort({ date: -1 })
      .limit(10);

      console.log(`✅ ${recentTransactions.length} transações recentes encontradas`);
    } catch (error) {
      console.error('❌ Erro ao buscar transações recentes:', error);
    }

    try {
      // Gastos por categoria
      categorySpending = await Transaction.aggregate([
        {
          $match: {
            userId: req.userId,
            type: 'expense',
            date: { $gte: startDate, $lte: endDate },
            isDeleted: { $ne: true },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: '$categoryId',
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'categories',
            localField: '_id',
            foreignField: '_id',
            as: 'category'
          }
        },
        {
          $unwind: '$category'
        },
        {
          $sort: { total: -1 }
        },
        {
          $limit: 10
        }
      ]);

      console.log(`✅ ${categorySpending.length} categorias com gastos encontradas`);
    } catch (error) {
      console.error('❌ Erro ao calcular gastos por categoria:', error);
    }

    try {
      // Evolução mensal (últimos 6 meses)
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      
      monthlyEvolution = await Transaction.aggregate([
        {
          $match: {
            userId: req.userId,
            date: { $gte: sixMonthsAgo },
            isDeleted: { $ne: true },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$date' },
              month: { $month: '$date' },
              type: '$type'
            },
            total: { $sum: '$amount' }
          }
        },
        {
          $group: {
            _id: {
              year: '$_id.year',
              month: '$_id.month'
            },
            income: {
              $sum: {
                $cond: [{ $eq: ['$_id.type', 'income'] }, '$total', 0]
              }
            },
            expense: {
              $sum: {
                $cond: [{ $eq: ['$_id.type', 'expense'] }, '$total', 0]
              }
            }
          }
        },
        {
          $addFields: {
            balance: { $subtract: ['$income', '$expense'] }
          }
        },
        {
          $sort: { '_id.year': 1, '_id.month': 1 }
        }
      ]);

      console.log(`✅ ${monthlyEvolution.length} meses de evolução calculados`);
    } catch (error) {
      console.error('❌ Erro ao calcular evolução mensal:', error);
    }

    // ✅ CORRIGIDO: Alertas simplificados
    const alerts = [];

    // Alertas de orçamentos excedidos
    activeBudgets.forEach(budget => {
      if (budget.isExceeded) {
        alerts.push({
          type: 'budget_exceeded',
          title: 'Orçamento Excedido',
          message: `O orçamento "${budget.name}" foi excedido`,
          severity: 'high',
          data: budget
        });
      } else if (budget.spentPercentage >= (budget.alertThreshold || 80)) {
        alerts.push({
          type: 'budget_warning',
          title: 'Orçamento Próximo do Limite',
          message: `O orçamento "${budget.name}" está ${budget.spentPercentage}% usado`,
          severity: 'medium',
          data: budget
        });
      }
    });

    // Alertas de metas próximas do prazo
    activeGoals.forEach(goal => {
      if (goal.daysRemaining <= 30 && goal.daysRemaining > 0) {
        alerts.push({
          type: 'goal_deadline',
          title: 'Meta Próxima do Prazo',
          message: `A meta "${goal.title}" vence em ${goal.daysRemaining} dias`,
          severity: goal.daysRemaining <= 7 ? 'high' : 'medium',
          data: goal
        });
      }
    });

    console.log(`✅ Dashboard calculado com sucesso: ${alerts.length} alertas`);

    res.json({
      success: true,
      data: {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        financialStats: financialStats || {
          income: 0,
          expense: 0,
          balance: 0,
          incomeCount: 0,
          expenseCount: 0,
          totalTransactions: 0
        },
        activeBudgets,
        activeGoals,
        recentTransactions,
        categorySpending,
        monthlyEvolution,
        alerts,
        summary: {
          totalBudgets: activeBudgets.length,
          totalGoals: activeGoals.length,
          completedGoals: activeGoals.filter(g => g.status === 'completed').length,
          alertsCount: alerts.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar dashboard:', error);
    console.error('❌ Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/user/stats - Estatísticas gerais do usuário
router.get('/stats', async (req, res) => {
  try {
    // Contar dados totais
    const [
      totalTransactions,
      totalCategories,
      totalBudgets,
      totalGoals,
      completedGoals
    ] = await Promise.all([
      Transaction.countDocuments({ userId: req.userId, isDeleted: { $ne: true } }),
      Category.countDocuments({ userId: req.userId, isActive: true }),
      Budget.countDocuments({ userId: req.userId }),
      Goal.countDocuments({ userId: req.userId }),
      Goal.countDocuments({ userId: req.userId, status: 'completed' })
    ]);

    // Estatísticas de transações por tipo
    const transactionStats = await Transaction.aggregate([
      {
        $match: {
          userId: req.userId,
          isDeleted: { $ne: true },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);

    // Estatísticas por método de pagamento
    const paymentMethodStats = await Transaction.aggregate([
      {
        $match: {
          userId: req.userId,
          type: 'expense',
          isDeleted: { $ne: true },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$paymentMethod',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { total: -1 }
      }
    ]);

    // Primeira e última transação
    const [firstTransaction] = await Transaction.find({
      userId: req.userId,
      isDeleted: { $ne: true }
    }).sort({ date: 1 }).limit(1);

    const accountAge = firstTransaction 
      ? Math.floor((Date.now() - firstTransaction.date.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    res.json({
      success: true,
      data: {
        totals: {
          transactions: totalTransactions,
          categories: totalCategories,
          budgets: totalBudgets,
          goals: totalGoals,
          completedGoals
        },
        transactionStats,
        paymentMethodStats,
        accountAge,
        memberSince: firstTransaction?.date || req.user.createdAt
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

// DELETE /api/user/account - Deletar conta
router.delete('/account', async (req, res) => {
  try {
    const { confirmPassword } = req.body;

    if (!confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Senha de confirmação é obrigatória'
      });
    }

    const user = await User.findById(req.userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    // Verificar senha
    const isPasswordValid = await user.comparePassword(confirmPassword);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Senha incorreta'
      });
    }

    // Deletar todos os dados do usuário
    await Promise.all([
      Transaction.deleteMany({ userId: req.userId }),
      Category.deleteMany({ userId: req.userId }),
      Budget.deleteMany({ userId: req.userId }),
      Goal.deleteMany({ userId: req.userId }),
      User.findByIdAndDelete(req.userId)
    ]);

    res.json({
      success: true,
      message: 'Conta deletada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar conta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/user/export - Exportar dados do usuário
router.post('/export', async (req, res) => {
  try {
    const { format = 'json', includeDeleted = false } = req.body;

    // Buscar todos os dados do usuário
    const userData = await User.findById(req.userId);
    
    const transactionQuery = { userId: req.userId };
    if (!includeDeleted) {
      transactionQuery.isDeleted = { $ne: true };
    }

    const [transactions, categories, budgets, goals] = await Promise.all([
      Transaction.find(transactionQuery).populate('categoryId', 'name'),
      Category.find({ userId: req.userId }),
      Budget.find({ userId: req.userId }).populate('categoryId', 'name'),
      Goal.find({ userId: req.userId }).populate('categoryId', 'name')
    ]);

    const exportData = {
      user: userData,
      transactions,
      categories,
      budgets,
      goals,
      exportedAt: new Date(),
      includeDeleted
    };

    if (format === 'csv') {
      // Para CSV, retornar apenas as transações (mais comum)
      const csvData = transactions.map(t => ({
        data: t.date.toISOString().split('T')[0],
        descricao: t.description,
        valor: t.amount,
        tipo: t.type === 'income' ? 'Receita' : 'Gasto',
        categoria: t.categoryId?.name || 'Sem categoria',
        observacoes: t.notes || ''
      }));

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="finance-app-data.csv"');
      
      // Simples conversão para CSV
      const headers = Object.keys(csvData[0] || {}).join(',');
      const rows = csvData.map(row => Object.values(row).join(','));
      const csv = [headers, ...rows].join('\n');
      
      return res.send(csv);
    }

    res.json({
      success: true,
      data: exportData
    });

  } catch (error) {
    console.error('Erro ao exportar dados:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
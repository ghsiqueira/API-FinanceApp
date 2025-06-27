// routes/budgets.js - ARQUIVO COMPLETO CORRIGIDO

const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Budget = require('../models/Budget');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticação em todas as rotas
router.use(authenticate);

// ===== VALIDAÇÕES =====
const createBudgetValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Nome é obrigatório')
    .isLength({ min: 2, max: 50 })
    .withMessage('Nome deve ter entre 2 e 50 caracteres'),
  body('amount')
    .isFloat({ min: 0.01, max: 999999999 })
    .withMessage('Valor deve estar entre R$ 0,01 e R$ 999.999.999'),
  body('categoryId')
    .notEmpty()
    .withMessage('Categoria é obrigatória')
    .isMongoId()
    .withMessage('ID da categoria inválido'),
  body('period')
    .optional()
    .isIn(['weekly', 'monthly', 'quarterly', 'yearly'])
    .withMessage('Período deve ser: weekly, monthly, quarterly ou yearly'),
  body('startDate')
    .notEmpty()
    .withMessage('Data de início é obrigatória')
    .isISO8601()
    .withMessage('Formato de data de início inválido'),
  body('endDate')
    .notEmpty()
    .withMessage('Data de fim é obrigatória')
    .isISO8601()
    .withMessage('Formato de data de fim inválido'),
  body('alertThreshold')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Limite de alerta deve estar entre 0 e 100'),
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Observações devem ter no máximo 500 caracteres'),
];

const updateBudgetValidation = [
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Nome não pode ser vazio')
    .isLength({ min: 2, max: 50 })
    .withMessage('Nome deve ter entre 2 e 50 caracteres'),
  body('amount')
    .optional()
    .isFloat({ min: 0.01, max: 999999999 })
    .withMessage('Valor deve estar entre R$ 0,01 e R$ 999.999.999'),
  body('categoryId')
    .optional()
    .isMongoId()
    .withMessage('ID da categoria inválido'),
  body('period')
    .optional()
    .isIn(['weekly', 'monthly', 'quarterly', 'yearly'])
    .withMessage('Período deve ser: weekly, monthly, quarterly ou yearly'),
  body('startDate')
    .optional()
    .isISO8601()
    .withMessage('Formato de data de início inválido'),
  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('Formato de data de fim inválido'),
  body('alertThreshold')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Limite de alerta deve estar entre 0 e 100'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('Status ativo deve ser verdadeiro ou falso'),
  body('autoRenew')
    .optional()
    .isBoolean()
    .withMessage('Renovação automática deve ser verdadeiro ou falso'),
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Observações devem ter no máximo 500 caracteres'),
];

// ===== FUNÇÕES AUXILIARES =====
const validateDateRange = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime())) {
    return { isValid: false, error: 'Data de início inválida' };
  }
  
  if (isNaN(end.getTime())) {
    return { isValid: false, error: 'Data de fim inválida' };
  }
  
  if (end <= start) {
    return { isValid: false, error: 'Data de fim deve ser posterior à data de início' };
  }
  
  // Verificar se o período não é muito longo (máximo 10 anos)
  const diffTime = end.getTime() - start.getTime();
  const diffDays = diffTime / (1000 * 3600 * 24);
  if (diffDays > 3650) { // 10 anos
    return { isValid: false, error: 'Período muito longo (máximo 10 anos)' };
  }
  
  return { isValid: true, startDate: start, endDate: end };
};

const checkCategoryExists = async (categoryId, userId) => {
  const category = await Category.findOne({ 
    _id: categoryId, 
    $or: [{ userId }, { isDefault: true }] 
  });
  return category;
};

// ===== ROTAS =====

// GET /api/budgets - Listar orçamentos
router.get('/', async (req, res) => {
  try {
    const { 
      status, 
      category, 
      period, 
      page = 1, 
      limit = 50,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    console.log('🔍 Parâmetros de busca:', req.query);
    
    // Construir filtros
    const filters = { userId: req.userId };
    
    // Filtro por status
    const now = new Date();
    if (status === 'active') {
      filters.isActive = true;
      filters.startDate = { $lte: now };
      filters.endDate = { $gte: now };
    } else if (status === 'inactive') {
      filters.isActive = false;
    } else if (status === 'expired') {
      filters.endDate = { $lt: now };
    } else if (status === 'future') {
      filters.startDate = { $gt: now };
    } else if (status === 'paused') {
      filters.isActive = false;
    }

    // Filtro por categoria
    if (category && mongoose.isValidObjectId(category)) {
      filters.categoryId = category;
    }

    // Filtro por período
    if (period && ['weekly', 'monthly', 'quarterly', 'yearly'].includes(period)) {
      filters.period = period;
    }

    // Filtro por busca de texto
    if (search && search.trim()) {
      filters.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { notes: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    console.log('🔍 Filtros aplicados:', JSON.stringify(filters, null, 2));

    // Validar ordenação
    const validSortFields = ['createdAt', 'name', 'amount', 'startDate', 'endDate'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    // Buscar orçamentos com paginação
    const skip = Math.max(0, (parseInt(page) - 1) * parseInt(limit));
    const limitNumber = Math.min(parseInt(limit), 100); // Máximo 100 por página
    
    const budgets = await Budget.find(filters)
      .populate('categoryId', 'name icon color type')
      .sort({ [sortField]: sortDirection })
      .skip(skip)
      .limit(limitNumber)
      .lean(); // Para melhor performance

    // Contar total para paginação
    const total = await Budget.countDocuments(filters);

    // Calcular gastos atuais para cada orçamento
    const budgetsWithSpent = await Promise.all(
      budgets.map(async (budget) => {
        try {
          // Buscar transações relacionadas
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
          });

          const spent = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
          
          return {
            ...budget,
            spent,
            percentage: budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0,
            remaining: Math.max(0, budget.amount - spent)
          };
        } catch (error) {
          console.error(`❌ Erro ao calcular gastos do orçamento ${budget._id}:`, error);
          return {
            ...budget,
            spent: 0,
            percentage: 0,
            remaining: budget.amount
          };
        }
      })
    );

    console.log(`✅ ${budgetsWithSpent.length} orçamentos encontrados de ${total} total`);

    res.json({
      success: true,
      data: { 
        budgets: budgetsWithSpent,
        pagination: {
          page: parseInt(page),
          limit: limitNumber,
          total,
          pages: Math.ceil(total / limitNumber),
          hasNext: skip + limitNumber < total,
          hasPrev: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('❌ Erro ao listar orçamentos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/budgets/stats - Estatísticas dos orçamentos
router.get('/stats', async (req, res) => {
  try {
    const { period = 'current' } = req.query;
    const now = new Date();
    
    console.log('📊 Calculando estatísticas dos orçamentos...');
    
    // Buscar todos os orçamentos do usuário
    const allBudgets = await Budget.find({ userId: req.userId })
      .populate('categoryId', 'name icon color type')
      .lean();

    if (allBudgets.length === 0) {
      return res.json({
        success: true,
        data: {
          stats: {
            total: 0,
            active: 0,
            inactive: 0,
            expired: 0,
            future: 0,
            totalBudgeted: 0,
            totalSpent: 0,
            avgUtilization: 0,
            byCategory: [],
            byPeriod: [],
            alerts: [],
            trends: {
              thisMonth: 0,
              lastMonth: 0,
              growth: 0
            }
          }
        }
      });
    }

    // Calcular estatísticas básicas
    const stats = {
      total: allBudgets.length,
      active: 0,
      inactive: 0,
      expired: 0,
      future: 0,
      totalBudgeted: 0,
      totalSpent: 0,
      avgUtilization: 0,
      byCategory: {},
      byPeriod: {},
      alerts: [],
      trends: {
        thisMonth: 0,
        lastMonth: 0,
        growth: 0
      }
    };

    // Processar cada orçamento
    for (const budget of allBudgets) {
      const startDate = new Date(budget.startDate);
      const endDate = new Date(budget.endDate);
      
      // Classificar status
      if (!budget.isActive) {
        stats.inactive++;
      } else if (startDate > now) {
        stats.future++;
      } else if (endDate < now) {
        stats.expired++;
      } else {
        stats.active++;
      }

      stats.totalBudgeted += budget.amount || 0;

      // Calcular gastos
      try {
        const transactions = await Transaction.find({
          userId: req.userId,
          categoryId: budget.categoryId?._id,
          type: 'expense',
          status: 'completed',
          isDeleted: { $ne: true },
          date: {
            $gte: startDate,
            $lte: endDate
          }
        });

        const spent = transactions.reduce((sum, t) => sum + t.amount, 0);
        stats.totalSpent += spent;

        // Agrupar por categoria
        const categoryName = budget.categoryId?.name || 'Sem categoria';
        if (!stats.byCategory[categoryName]) {
          stats.byCategory[categoryName] = {
            budgeted: 0,
            spent: 0,
            count: 0,
            icon: budget.categoryId?.icon || 'help-circle',
            color: budget.categoryId?.color || '#666666'
          };
        }
        stats.byCategory[categoryName].budgeted += budget.amount || 0;
        stats.byCategory[categoryName].spent += spent;
        stats.byCategory[categoryName].count += 1;

        // Agrupar por período
        const periodKey = budget.period || 'monthly';
        if (!stats.byPeriod[periodKey]) {
          stats.byPeriod[periodKey] = {
            budgeted: 0,
            spent: 0,
            count: 0
          };
        }
        stats.byPeriod[periodKey].budgeted += budget.amount || 0;
        stats.byPeriod[periodKey].spent += spent;
        stats.byPeriod[periodKey].count += 1;

        // Verificar alertas
        const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
        const threshold = budget.alertThreshold || 80;
        
        if (percentage >= threshold && budget.isActive && startDate <= now && endDate >= now) {
          stats.alerts.push({
            budgetId: budget._id,
            name: budget.name,
            percentage: Math.round(percentage),
            threshold,
            category: categoryName,
            spent,
            budgeted: budget.amount,
            severity: percentage >= 100 ? 'critical' : percentage >= 90 ? 'high' : 'medium'
          });
        }

      } catch (error) {
        console.error(`❌ Erro ao processar orçamento ${budget._id}:`, error);
      }
    }

    // Calcular utilização média
    stats.avgUtilization = stats.totalBudgeted > 0 
      ? Math.round((stats.totalSpent / stats.totalBudgeted) * 100) 
      : 0;

    // Converter objetos em arrays para facilitar uso no frontend
    stats.byCategory = Object.entries(stats.byCategory).map(([name, data]) => ({
      name,
      ...data,
      utilization: data.budgeted > 0 ? Math.round((data.spent / data.budgeted) * 100) : 0
    })).sort((a, b) => b.budgeted - a.budgeted);

    stats.byPeriod = Object.entries(stats.byPeriod).map(([period, data]) => ({
      period,
      ...data,
      utilization: data.budgeted > 0 ? Math.round((data.spent / data.budgeted) * 100) : 0
    })).sort((a, b) => b.budgeted - a.budgeted);

    // Ordenar alertas por severidade
    stats.alerts.sort((a, b) => {
      const severityOrder = { critical: 3, high: 2, medium: 1 };
      return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
    });

    // Calcular tendências (comparar com mês anterior)
    try {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const thisMonthBudgets = allBudgets.filter(b => 
        new Date(b.createdAt) >= currentMonth
      ).length;

      const lastMonthBudgets = allBudgets.filter(b => 
        new Date(b.createdAt) >= lastMonth && 
        new Date(b.createdAt) <= lastMonthEnd
      ).length;

      stats.trends.thisMonth = thisMonthBudgets;
      stats.trends.lastMonth = lastMonthBudgets;
      stats.trends.growth = lastMonthBudgets > 0 
        ? Math.round(((thisMonthBudgets - lastMonthBudgets) / lastMonthBudgets) * 100)
        : thisMonthBudgets > 0 ? 100 : 0;

    } catch (error) {
      console.error('❌ Erro ao calcular tendências:', error);
    }

    console.log('📊 Estatísticas calculadas:', {
      total: stats.total,
      active: stats.active,
      totalBudgeted: stats.totalBudgeted,
      totalSpent: stats.totalSpent,
      alerts: stats.alerts.length
    });

    res.json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    console.error('❌ Erro ao calcular estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/budgets - Criar orçamento
router.post('/', createBudgetValidation, async (req, res) => {
  try {
    // Verificar erros de validação
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Erros de validação:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { 
      name, 
      amount, 
      categoryId, 
      period = 'monthly', 
      startDate, 
      endDate, 
      alertThreshold = 80, 
      notes = '', 
      isActive = true,
      autoRenew = false
    } = req.body;

    console.log('📝 Dados recebidos para criação:', {
      name, amount, categoryId, period, startDate, endDate, alertThreshold, isActive
    });

    // ✅ VALIDAÇÃO ROBUSTA DAS DATAS
    const dateValidation = validateDateRange(startDate, endDate);
    if (!dateValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: dateValidation.error
      });
    }

    // Verificar se a categoria existe e pertence ao usuário
    const category = await checkCategoryExists(categoryId, req.userId);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Categoria não encontrada ou não acessível'
      });
    }

    // Verificar se não existe orçamento ativo para a mesma categoria no mesmo período
    const existingBudget = await Budget.findOne({
      userId: req.userId,
      categoryId,
      isActive: true,
      $or: [
        {
          startDate: { $lte: dateValidation.endDate },
          endDate: { $gte: dateValidation.startDate }
        }
      ]
    });

    if (existingBudget) {
      return res.status(400).json({
        success: false,
        message: `Já existe um orçamento ativo para a categoria "${category.name}" neste período`
      });
    }

    // Criar novo orçamento
    const newBudget = new Budget({
      name: name.trim(),
      amount,
      categoryId,
      period,
      startDate: dateValidation.startDate,
      endDate: dateValidation.endDate,
      alertThreshold,
      notes: notes.trim(),
      isActive,
      autoRenew,
      userId: req.userId,
      spent: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await newBudget.save();

    // Buscar orçamento criado com população
    const createdBudget = await Budget.findById(newBudget._id)
      .populate('categoryId', 'name icon color type');

    console.log('✅ Orçamento criado:', createdBudget._id);

    res.status(201).json({
      success: true,
      message: 'Orçamento criado com sucesso',
      data: { budget: createdBudget }
    });

  } catch (error) {
    console.error('❌ Erro ao criar orçamento:', error);
    
    // Tratar erros específicos
    if (error.code === 11000) { // Duplicate key error
      return res.status(400).json({
        success: false,
        message: 'Já existe um orçamento com estes dados'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/budgets/:id - Buscar orçamento específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validar ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID do orçamento inválido'
      });
    }

    console.log('🔍 Buscando orçamento:', id);

    const budget = await Budget.findOne({
      _id: id,
      userId: req.userId
    }).populate('categoryId', 'name icon color type');

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    // Calcular valor gasto atual
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

    const spent = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    
    // Atualizar valor gasto no orçamento
    budget.spent = spent;
    await budget.save();

    // Calcular estatísticas detalhadas
    const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
    const remaining = Math.max(0, budget.amount - spent);
    
    // Calcular gastos por dia para gráfico
    const dailySpending = {};
    transactions.forEach(transaction => {
      const date = transaction.date.toISOString().split('T')[0];
      dailySpending[date] = (dailySpending[date] || 0) + transaction.amount;
    });

    // Calcular média diária
    const now = new Date();
    const startDate = new Date(budget.startDate);
    const endDate = new Date(budget.endDate);
    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const daysPassed = Math.min(totalDays, Math.ceil((now - startDate) / (1000 * 60 * 60 * 24)));
    const dailyAverage = daysPassed > 0 ? spent / daysPassed : 0;
    const projectedSpending = dailyAverage * totalDays;

    console.log('✅ Orçamento encontrado:', budget._id);

    res.json({
      success: true,
      data: {
        budget: {
          ...budget.toObject(),
          spent,
          percentage: Math.round(percentage * 100) / 100,
          remaining,
          dailyAverage,
          projectedSpending,
          daysPassed,
          totalDays,
          daysRemaining: Math.max(0, totalDays - daysPassed)
        },
        transactions,
        dailySpending,
        analytics: {
          isOnTrack: projectedSpending <= budget.amount,
          overbudgetProjection: Math.max(0, projectedSpending - budget.amount),
          remainingDaily: remaining / Math.max(1, totalDays - daysPassed),
          status: percentage >= 100 ? 'over' : 
                 percentage >= 90 ? 'critical' : 
                 percentage >= 70 ? 'warning' : 'good'
        }
      }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PUT /api/budgets/:id - Atualizar orçamento
router.put('/:id', updateBudgetValidation, async (req, res) => {
  try {
    // Verificar erros de validação
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Erros de validação:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { 
      name, 
      amount, 
      categoryId, 
      period, 
      startDate, 
      endDate, 
      alertThreshold, 
      notes, 
      isActive,
      autoRenew
    } = req.body;

    // Validar ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID do orçamento inválido'
      });
    }

    console.log('🔄 Atualizando orçamento:', id);
    console.log('📝 Dados recebidos:', req.body);

    // ✅ VALIDAÇÃO ROBUSTA DAS DATAS (se fornecidas)
    if (startDate && endDate) {
      const dateValidation = validateDateRange(startDate, endDate);
      if (!dateValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: dateValidation.error
        });
      }
    } else if (startDate || endDate) {
      return res.status(400).json({
        success: false,
        message: 'Ambas as datas (início e fim) devem ser fornecidas juntas'
      });
    }

    // Buscar orçamento existente
    const budget = await Budget.findOne({
      _id: id,
      userId: req.userId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    // Verificar categoria se fornecida
    if (categoryId && categoryId !== budget.categoryId.toString()) {
      const category = await checkCategoryExists(categoryId, req.userId);
      if (!category) {
        return res.status(400).json({
          success: false,
          message: 'Categoria não encontrada ou não acessível'
        });
      }

      // Verificar conflitos com outros orçamentos ativos
      const conflictingBudget = await Budget.findOne({
        _id: { $ne: id },
        userId: req.userId,
        categoryId,
        isActive: true,
        $or: [
          {
            startDate: { $lte: endDate || budget.endDate },
            endDate: { $gte: startDate || budget.startDate }
          }
        ]
      });

      if (conflictingBudget) {
        return res.status(400).json({
          success: false,
          message: `Já existe um orçamento ativo para esta categoria no período especificado`
        });
      }
    }

    // Preparar dados para atualização
    const updateData = {};
    
    if (name !== undefined) updateData.name = name.trim();
    if (amount !== undefined) updateData.amount = amount;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (period !== undefined) updateData.period = period;
    if (alertThreshold !== undefined) updateData.alertThreshold = alertThreshold;
    if (notes !== undefined) updateData.notes = notes.trim();
    if (isActive !== undefined) updateData.isActive = isActive;
    if (autoRenew !== undefined) updateData.autoRenew = autoRenew;
    
    // Adicionar datas se fornecidas
    if (startDate && endDate) {
      const dateValidation = validateDateRange(startDate, endDate);
      updateData.startDate = dateValidation.startDate;
      updateData.endDate = dateValidation.endDate;
    }

    updateData.updatedAt = new Date();

    console.log('📤 Dados para atualização:', updateData);

    // Atualizar orçamento
    const updatedBudget = await Budget.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('categoryId', 'name icon color type');

    if (!updatedBudget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado após atualização'
      });
    }

    // Recalcular gastos se categoria ou datas mudaram
    if (categoryId || startDate || endDate) {
      const transactions = await Transaction.find({
        userId: req.userId,
        categoryId: updatedBudget.categoryId._id,
        type: 'expense',
        status: 'completed',
        isDeleted: { $ne: true },
        date: {
          $gte: updatedBudget.startDate,
          $lte: updatedBudget.endDate
        }
      });

      const spent = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
      updatedBudget.spent = spent;
      await updatedBudget.save();
    }

    console.log('✅ Orçamento atualizado:', updatedBudget._id);

    res.json({
      success: true,
      message: 'Orçamento atualizado com sucesso',
      data: { budget: updatedBudget }
    });

  } catch (error) {
    console.error('❌ Erro ao atualizar orçamento:', error);
    
    // Tratar erros específicos
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Conflito com dados existentes'
      });
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: Object.values(error.errors).map(err => ({ message: err.message }))
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// DELETE /api/budgets/:id - Excluir orçamento
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validar ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID do orçamento inválido'
      });
    }

    console.log('🗑️ Excluindo orçamento:', id);

    // Buscar e excluir orçamento
    const budget = await Budget.findOneAndDelete({
      _id: id,
      userId: req.userId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    console.log('✅ Orçamento excluído:', budget.name);

    res.json({
      success: true,
      message: 'Orçamento excluído com sucesso',
      data: { budgetId: id }
    });

  } catch (error) {
    console.error('❌ Erro ao excluir orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PATCH /api/budgets/:id/toggle - Alternar status ativo/inativo
router.post('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;

    // Validar ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID do orçamento inválido'
      });
    }

    console.log('🔄 Alternando status do orçamento:', id);

    // Buscar orçamento
    const budget = await Budget.findOne({
      _id: id,
      userId: req.userId
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    // Alternar status
    budget.isActive = !budget.isActive;
    budget.updatedAt = new Date();
    
    await budget.save();

    // Buscar orçamento com categoria populada
    const updatedBudget = await Budget.findById(budget._id)
      .populate('categoryId', 'name icon color type');

    console.log(`✅ Status alterado para: ${budget.isActive ? 'Ativo' : 'Inativo'}`);

    res.json({
      success: true,
      message: `Orçamento ${budget.isActive ? 'ativado' : 'desativado'} com sucesso`,
      data: { budget: updatedBudget }
    });

  } catch (error) {
    console.error('❌ Erro ao alterar status:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PATCH /api/budgets/:id/recalculate - Recalcular gastos do orçamento
router.patch('/:id/recalculate', async (req, res) => {
  try {
    const { id } = req.params;

    // Validar ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID do orçamento inválido'
      });
    }

    console.log('🔄 Recalculando gastos do orçamento:', id);

    // Buscar orçamento
    const budget = await Budget.findOne({
      _id: id,
      userId: req.userId
    }).populate('categoryId', 'name icon color type');

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    // Recalcular gastos
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
    });

    const oldSpent = budget.spent || 0;
    const newSpent = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    
    budget.spent = newSpent;
    budget.updatedAt = new Date();
    await budget.save();

    console.log(`✅ Gastos recalculados: ${oldSpent} → ${newSpent}`);

    res.json({
      success: true,
      message: 'Gastos recalculados com sucesso',
      data: { 
        budget,
        oldSpent,
        newSpent,
        difference: newSpent - oldSpent
      }
    });

  } catch (error) {
    console.error('❌ Erro ao recalcular gastos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/budgets/:id/duplicate - Duplicar orçamento
router.post('/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, startDate, endDate } = req.body;

    // Validar ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID do orçamento inválido'
      });
    }

    console.log('📋 Duplicando orçamento:', id);

    // Buscar orçamento original
    const originalBudget = await Budget.findOne({
      _id: id,
      userId: req.userId
    });

    if (!originalBudget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento original não encontrado'
      });
    }

    // Validar datas se fornecidas
    let newStartDate = originalBudget.startDate;
    let newEndDate = originalBudget.endDate;

    if (startDate && endDate) {
      const dateValidation = validateDateRange(startDate, endDate);
      if (!dateValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: dateValidation.error
        });
      }
      newStartDate = dateValidation.startDate;
      newEndDate = dateValidation.endDate;
    }

    // Verificar conflitos
    const conflictingBudget = await Budget.findOne({
      userId: req.userId,
      categoryId: originalBudget.categoryId,
      isActive: true,
      $or: [
        {
          startDate: { $lte: newEndDate },
          endDate: { $gte: newStartDate }
        }
      ]
    });

    if (conflictingBudget) {
      return res.status(400).json({
        success: false,
        message: 'Já existe um orçamento ativo para esta categoria no período especificado'
      });
    }

    // Criar orçamento duplicado
    const duplicatedBudget = new Budget({
      name: name || `${originalBudget.name} (Cópia)`,
      amount: originalBudget.amount,
      categoryId: originalBudget.categoryId,
      period: originalBudget.period,
      startDate: newStartDate,
      endDate: newEndDate,
      alertThreshold: originalBudget.alertThreshold,
      notes: originalBudget.notes,
      isActive: true,
      autoRenew: originalBudget.autoRenew,
      userId: req.userId,
      spent: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await duplicatedBudget.save();

    // Buscar orçamento criado com população
    const createdBudget = await Budget.findById(duplicatedBudget._id)
      .populate('categoryId', 'name icon color type');

    console.log('✅ Orçamento duplicado:', createdBudget._id);

    res.status(201).json({
      success: true,
      message: 'Orçamento duplicado com sucesso',
      data: { budget: createdBudget }
    });

  } catch (error) {
    console.error('❌ Erro ao duplicar orçamento:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/budgets/:id/transactions - Buscar transações do orçamento
router.get('/:id/transactions', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, sortBy = 'date', sortOrder = 'desc' } = req.query;

    // Validar ID
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID do orçamento inválido'
      });
    }

    console.log('📊 Buscando transações do orçamento:', id);

    // Buscar orçamento
    const budget = await Budget.findOne({
      _id: id,
      userId: req.userId
    }).populate('categoryId');

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Orçamento não encontrado'
      });
    }

    // Configurar paginação e ordenação
    const skip = Math.max(0, (parseInt(page) - 1) * parseInt(limit));
    const limitNumber = Math.min(parseInt(limit), 100);
    
    const validSortFields = ['date', 'amount', 'description'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'date';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    // Buscar transações
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
    })
    .sort({ [sortField]: sortDirection })
    .skip(skip)
    .limit(limitNumber)
    .populate('categoryId', 'name icon color');

    // Contar total
    const total = await Transaction.countDocuments({
      userId: req.userId,
      categoryId: budget.categoryId._id,
      type: 'expense',
      status: 'completed',
      isDeleted: { $ne: true },
      date: {
        $gte: budget.startDate,
        $lte: budget.endDate
      }
    });

    console.log(`✅ ${transactions.length} transações encontradas`);

    res.json({
      success: true,
      data: { 
        transactions,
        budget: {
          _id: budget._id,
          name: budget.name,
          amount: budget.amount,
          spent: budget.spent,
          category: budget.categoryId
        },
        pagination: {
          page: parseInt(page),
          limit: limitNumber,
          total,
          pages: Math.ceil(total / limitNumber)
        }
      }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar transações:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/budgets/category/:categoryId - Buscar orçamentos por categoria
router.get('/category/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { status = 'all', includeInactive = false } = req.query;

    // Validar ID da categoria
    if (!mongoose.isValidObjectId(categoryId)) {
      return res.status(400).json({
        success: false,
        message: 'ID da categoria inválido'
      });
    }

    console.log('🔍 Buscando orçamentos da categoria:', categoryId);

    // Construir filtros
    const filters = { 
      userId: req.userId,
      categoryId 
    };

    const now = new Date();
    
    if (status === 'active') {
      filters.isActive = true;
      filters.startDate = { $lte: now };
      filters.endDate = { $gte: now };
    } else if (status === 'expired') {
      filters.endDate = { $lt: now };
    } else if (status === 'future') {
      filters.startDate = { $gt: now };
    }

    if (!includeInactive) {
      filters.isActive = true;
    }

    // Buscar orçamentos
    const budgets = await Budget.find(filters)
      .populate('categoryId', 'name icon color type')
      .sort({ startDate: -1 });

    // Calcular gastos para cada orçamento
    for (const budget of budgets) {
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
      });

      budget.spent = transactions.reduce((sum, t) => sum + t.amount, 0);
      await budget.save();
    }

    console.log(`✅ ${budgets.length} orçamentos encontrados para a categoria`);

    res.json({
      success: true,
      data: { budgets }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar orçamentos por categoria:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/budgets/bulk-update - Atualização em lote
router.post('/bulk-update', async (req, res) => {
  try {
    const { budgetIds, updates } = req.body;

    // Validar entrada
    if (!Array.isArray(budgetIds) || budgetIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Lista de IDs de orçamentos é obrigatória'
      });
    }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Dados de atualização são obrigatórios'
      });
    }

    // Validar IDs
    for (const id of budgetIds) {
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: `ID inválido: ${id}`
        });
      }
    }

    console.log('🔄 Atualizando orçamentos em lote:', budgetIds.length);

    // Preparar dados de atualização
    const allowedFields = ['isActive', 'alertThreshold', 'autoRenew', 'notes'];
    const updateData = {};
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum campo válido para atualização fornecido'
      });
    }

    updateData.updatedAt = new Date();

    // Executar atualização em lote
    const result = await Budget.updateMany(
      { 
        _id: { $in: budgetIds },
        userId: req.userId 
      },
      { $set: updateData }
    );

    console.log(`✅ ${result.modifiedCount} orçamentos atualizados`);

    res.json({
      success: true,
      message: `${result.modifiedCount} orçamentos atualizados com sucesso`,
      data: { 
        matched: result.matchedCount,
        modified: result.modifiedCount 
      }
    });

  } catch (error) {
    console.error('❌ Erro na atualização em lote:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Middleware para tratamento de erros não capturados
router.use((error, req, res, next) => {
  console.error('❌ Erro não tratado na rota de orçamentos:', error);
  
  res.status(500).json({
    success: false,
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

module.exports = router;
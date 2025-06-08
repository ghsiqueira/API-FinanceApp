const express = require('express');
const { body, validationResult } = require('express-validator');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticação em todas as rotas
router.use(authenticate);

// Validações
const categoryValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 30 })
    .withMessage('Nome deve ter entre 1 e 30 caracteres'),
  body('icon')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Ícone deve ter no máximo 50 caracteres'),
  body('color')
    .optional()
    .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .withMessage('Cor deve estar no formato hexadecimal'),
  body('type')
    .optional()
    .isIn(['expense', 'income', 'both'])
    .withMessage('Tipo deve ser expense, income ou both'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Descrição deve ter no máximo 100 caracteres')
];

// GET /api/categories/stats - Estatísticas das categorias (ANTES de /:id)
router.get('/stats', async (req, res) => {
  try {
    const { startDate, endDate, type } = req.query;

    const matchQuery = {
      userId: req.userId,
      isDeleted: { $ne: true },
      status: 'completed'
    };

    if (type && ['income', 'expense'].includes(type)) {
      matchQuery.type = type;
    }

    if (startDate || endDate) {
      matchQuery.date = {};
      if (startDate) matchQuery.date.$gte = new Date(startDate);
      if (endDate) matchQuery.date.$lte = new Date(endDate);
    }

    const stats = await Transaction.aggregate([
      { $match: matchQuery },
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
              {
                name: 'Sem categoria',
                icon: 'help-circle',
                color: '#A8A8A8'
              }
            ]
          },
          total: { $round: ['$total', 2] },
          count: 1,
          avgAmount: { $round: ['$avgAmount', 2] }
        }
      },
      {
        $sort: { total: -1 }
      }
    ]);

    // Calcular percentuais
    const totalAmount = stats.reduce((sum, stat) => sum + stat.total, 0);
    const statsWithPercentage = stats.map(stat => ({
      ...stat,
      percentage: totalAmount > 0 ? Math.round((stat.total / totalAmount) * 100) : 0
    }));

    res.json({
      success: true,
      data: {
        stats: statsWithPercentage,
        summary: {
          totalAmount,
          categoriesCount: stats.length,
          transactionsCount: stats.reduce((sum, stat) => sum + stat.count, 0)
        }
      }
    });

  } catch (error) {
    console.error('Erro ao buscar estatísticas das categorias:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/categories/reset-defaults - Recriar categorias padrão (ANTES de /:id)
router.post('/reset-defaults', async (req, res) => {
  try {
    // Remover categorias padrão existentes
    await Category.deleteMany({
      userId: req.userId,
      isDefault: true
    });

    // Recriar categorias padrão
    await Category.createDefaultCategories(req.userId);

    const categories = await Category.find({
      userId: req.userId,
      isDefault: true
    }).sort({ name: 1 });

    res.json({
      success: true,
      message: 'Categorias padrão recriadas com sucesso',
      data: { categories }
    });

  } catch (error) {
    console.error('Erro ao recriar categorias padrão:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/categories - Listar categorias
router.get('/', async (req, res) => {
  try {
    const { type, includeInactive } = req.query;

    const filters = { userId: req.userId };
    
    if (type && ['expense', 'income', 'both'].includes(type)) {
      filters.$or = [
        { type: type },
        { type: 'both' }
      ];
    }

    if (!includeInactive) {
      filters.isActive = true;
    }

    const categories = await Category.find(filters)
      .sort({ isDefault: -1, name: 1 });

    res.json({
      success: true,
      data: { categories }
    });

  } catch (error) {
    console.error('Erro ao listar categorias:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// GET /api/categories/:id - Buscar categoria específica (DEPOIS das rotas específicas)
router.get('/:id', async (req, res) => {
  try {
    const category = await Category.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Categoria não encontrada'
      });
    }

    // Buscar estatísticas da categoria
    const stats = await Transaction.aggregate([
      {
        $match: {
          categoryId: category._id,
          userId: req.userId,
          isDeleted: { $ne: true },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    const categoryStats = {
      income: { total: 0, count: 0 },
      expense: { total: 0, count: 0 }
    };

    stats.forEach(stat => {
      categoryStats[stat._id] = {
        total: stat.total,
        count: stat.count
      };
    });

    res.json({
      success: true,
      data: {
        category,
        stats: categoryStats
      }
    });

  } catch (error) {
    console.error('Erro ao buscar categoria:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/categories - Criar categoria
router.post('/', categoryValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    // Verificar se já existe categoria com mesmo nome
    const existingCategory = await Category.findOne({
      name: req.body.name,
      userId: req.userId,
      isActive: true
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Já existe uma categoria com este nome'
      });
    }

    const category = new Category({
      ...req.body,
      userId: req.userId
    });

    await category.save();

    res.status(201).json({
      success: true,
      message: 'Categoria criada com sucesso',
      data: { category }
    });

  } catch (error) {
    console.error('Erro ao criar categoria:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// PUT /api/categories/:id - Atualizar categoria
router.put('/:id', categoryValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const category = await Category.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Categoria não encontrada'
      });
    }

    // Verificar se o novo nome já existe (se mudou)
    if (req.body.name && req.body.name !== category.name) {
      const existingCategory = await Category.findOne({
        name: req.body.name,
        userId: req.userId,
        isActive: true,
        _id: { $ne: category._id }
      });

      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: 'Já existe uma categoria com este nome'
        });
      }
    }

    // Não permitir editar categorias padrão (apenas cor e ícone)
    if (category.isDefault) {
      const allowedFields = ['icon', 'color', 'description'];
      const updateData = {};
      
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      });

      Object.assign(category, updateData);
    } else {
      Object.assign(category, req.body);
    }

    await category.save();

    res.json({
      success: true,
      message: 'Categoria atualizada com sucesso',
      data: { category }
    });

  } catch (error) {
    console.error('Erro ao atualizar categoria:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// DELETE /api/categories/:id - Deletar categoria
router.delete('/:id', async (req, res) => {
  try {
    const category = await Category.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Categoria não encontrada'
      });
    }

    // Não permitir deletar categorias padrão
    if (category.isDefault) {
      return res.status(400).json({
        success: false,
        message: 'Categorias padrão não podem ser deletadas'
      });
    }

    // Verificar se há transações usando esta categoria
    const transactionCount = await Transaction.countDocuments({
      categoryId: category._id,
      userId: req.userId,
      isDeleted: { $ne: true }
    });

    if (transactionCount > 0) {
      // Soft delete - apenas marcar como inativa
      category.isActive = false;
      await category.save();

      return res.json({
        success: true,
        message: 'Categoria desativada com sucesso (possui transações associadas)'
      });
    }

    // Se não há transações, pode deletar completamente
    await Category.findByIdAndDelete(category._id);

    res.json({
      success: true,
      message: 'Categoria deletada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar categoria:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// POST /api/categories/:id/restore - Restaurar categoria
router.post('/:id/restore', async (req, res) => {
  try {
    const category = await Category.findOne({
      _id: req.params.id,
      userId: req.userId,
      isActive: false
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Categoria não encontrada'
      });
    }

    category.isActive = true;
    await category.save();

    res.json({
      success: true,
      message: 'Categoria restaurada com sucesso',
      data: { category }
    });

  } catch (error) {
    console.error('Erro ao restaurar categoria:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
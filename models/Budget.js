const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nome do orçamento é obrigatório'],
    trim: true,
    maxlength: [50, 'Nome deve ter no máximo 50 caracteres']
  },
  amount: {
    type: Number,
    required: [true, 'Valor do orçamento é obrigatório'],
    min: [0.01, 'Valor deve ser maior que zero']
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Categoria é obrigatória']
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  period: {
    type: String,
    enum: ['weekly', 'monthly', 'quarterly', 'yearly'],
    default: 'monthly'
  },
  startDate: {
    type: Date,
    required: [true, 'Data de início é obrigatória']
  },
  endDate: {
    type: Date,
    required: [true, 'Data de fim é obrigatória']
  },
  spent: {
    type: Number,
    default: 0,
    min: 0
  },
  alertThreshold: {
    type: Number,
    min: 0,
    max: 100,
    default: 80 // 80% do orçamento
  },
  alertSent: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  autoRenew: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    maxlength: [200, 'Notas devem ter no máximo 200 caracteres']
  },
  color: {
    type: String,
    default: '#3B82F6',
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Cor deve estar no formato hexadecimal']
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  }
});

// Virtual para calcular percentual gasto
budgetSchema.virtual('spentPercentage').get(function() {
  return this.amount > 0 ? Math.round((this.spent / this.amount) * 100) : 0;
});

// Virtual para calcular valor restante
budgetSchema.virtual('remaining').get(function() {
  return Math.max(0, this.amount - this.spent);
});

// Virtual para verificar se excedeu
budgetSchema.virtual('isExceeded').get(function() {
  return this.spent > this.amount;
});

// Virtual para verificar se deve alertar
budgetSchema.virtual('shouldAlert').get(function() {
  return this.spentPercentage >= this.alertThreshold && !this.alertSent;
});

// Indexes
budgetSchema.index({ userId: 1, isActive: 1 });
budgetSchema.index({ userId: 1, categoryId: 1 });
budgetSchema.index({ userId: 1, endDate: 1 });
budgetSchema.index({ startDate: 1, endDate: 1 });

// Middleware para validar datas
budgetSchema.pre('save', function(next) {
  if (this.startDate >= this.endDate) {
    return next(new Error('Data de fim deve ser posterior à data de início'));
  }
  next();
});

// Certifique-se de que o virtual isExceeded está definido:
budgetSchema.virtual('isExceeded').get(function() {
  return this.spent > this.amount;
});

// E que os virtuals são incluídos no JSON:
budgetSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

// Método para calcular gasto atual
budgetSchema.methods.calculateSpent = async function() {
  const Transaction = mongoose.model('Transaction');
  
  const result = await Transaction.aggregate([
    {
      $match: {
        userId: this.userId,
        categoryId: this.categoryId,
        type: 'expense',
        status: 'completed',
        isDeleted: { $ne: true },
        date: {
          $gte: this.startDate,
          $lte: this.endDate
        }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' }
      }
    }
  ]);

  this.spent = result.length > 0 ? result[0].total : 0;
  return this.spent;
};

// Método para renovar orçamento
budgetSchema.methods.renew = function() {
  if (!this.autoRenew) return null;

  const duration = this.endDate - this.startDate;
  this.startDate = new Date();
  this.endDate = new Date(this.startDate.getTime() + duration);
  this.spent = 0;
  this.alertSent = false;

  return this.save();
};

// Método estático para buscar orçamentos ativos
budgetSchema.statics.getActiveBudgets = function(userId) {
  return this.find({
    userId,
    isActive: true,
    startDate: { $lte: new Date() },
    endDate: { $gte: new Date() }
  }).populate('categoryId');
};

// Método estático para verificar orçamentos que precisam de alerta
budgetSchema.statics.getBudgetsNeedingAlert = function() {
  return this.find({
    isActive: true,
    alertSent: false,
    startDate: { $lte: new Date() },
    endDate: { $gte: new Date() }
  }).populate('userId categoryId');
};

module.exports = mongoose.model('Budget', budgetSchema);
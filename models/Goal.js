const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Título da meta é obrigatório'],
    trim: true,
    maxlength: [50, 'Título deve ter no máximo 50 caracteres']
  },
  description: {
    type: String,
    maxlength: [200, 'Descrição deve ter no máximo 200 caracteres']
  },
  targetAmount: {
    type: Number,
    required: [true, 'Valor da meta é obrigatório'],
    min: [0.01, 'Valor deve ser maior que zero']
  },
  currentAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetDate: {
    type: Date,
    required: [true, 'Data da meta é obrigatória']
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'paused', 'cancelled'],
    default: 'active'
  },
  icon: {
    type: String,
    default: 'flag'
  },
  color: {
    type: String,
    default: '#3B82F6',
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Cor deve estar no formato hexadecimal']
  },
  isAutoContribute: {
    type: Boolean,
    default: false
  },
  autoContributeAmount: {
    type: Number,
    min: 0,
    default: 0
  },
  autoContributeFrequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    default: 'monthly'
  },
  lastContribution: {
    type: Date,
    default: null
  },
  contributions: [{
    amount: {
      type: Number,
      required: true,
      min: 0.01
    },
    date: {
      type: Date,
      default: Date.now
    },
    note: {
      type: String,
      maxlength: [100, 'Nota deve ter no máximo 100 caracteres']
    },
    isAutomatic: {
      type: Boolean,
      default: false
    }
  }],
  reminders: [{
    message: {
      type: String,
      required: true,
      maxlength: [100, 'Mensagem deve ter no máximo 100 caracteres']
    },
    date: {
      type: Date,
      required: true
    },
    sent: {
      type: Boolean,
      default: false
    }
  }],
  completedAt: {
    type: Date,
    default: null
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [20, 'Tag deve ter no máximo 20 caracteres']
  }]
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

// Virtual para calcular percentual atingido
goalSchema.virtual('progressPercentage').get(function() {
  return this.targetAmount > 0 ? Math.round((this.currentAmount / this.targetAmount) * 100) : 0;
});

// Virtual para calcular valor restante
goalSchema.virtual('remainingAmount').get(function() {
  return Math.max(0, this.targetAmount - this.currentAmount);
});

// Virtual para verificar se foi atingida
goalSchema.virtual('isCompleted').get(function() {
  return this.currentAmount >= this.targetAmount || this.status === 'completed';
});

// Virtual para calcular dias restantes
goalSchema.virtual('daysRemaining').get(function() {
  if (this.status === 'completed') return 0;
  const today = new Date();
  const target = new Date(this.targetDate);
  const diff = target - today;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
});

// Virtual para calcular quanto economizar por dia
goalSchema.virtual('dailySavingsNeeded').get(function() {
  if (this.isCompleted || this.daysRemaining === 0) return 0;
  return Math.ceil(this.remainingAmount / this.daysRemaining);
});

// Virtual para calcular quanto economizar por mês
goalSchema.virtual('monthlySavingsNeeded').get(function() {
  if (this.isCompleted) return 0;
  const today = new Date();
  const target = new Date(this.targetDate);
  const monthsRemaining = Math.max(1, (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth()));
  return Math.ceil(this.remainingAmount / monthsRemaining);
});

// Indexes
goalSchema.index({ userId: 1, status: 1 });
goalSchema.index({ userId: 1, targetDate: 1 });
goalSchema.index({ userId: 1, priority: 1 });
goalSchema.index({ targetDate: 1, status: 1 });

// Middleware para validar data
goalSchema.pre('save', function(next) {
  if (this.targetDate <= this.startDate) {
    return next(new Error('Data da meta deve ser posterior à data de início'));
  }
  
  // Verificar se atingiu a meta
  if (this.currentAmount >= this.targetAmount && this.status === 'active') {
    this.status = 'completed';
    this.completedAt = new Date();
  }
  
  next();
});

// Método para adicionar contribuição
goalSchema.methods.addContribution = function(amount, note = '', isAutomatic = false) {
  if (amount <= 0) {
    throw new Error('Valor da contribuição deve ser maior que zero');
  }
  
  if (this.status !== 'active') {
    throw new Error('Meta deve estar ativa para receber contribuições');
  }

  this.contributions.push({
    amount,
    note,
    isAutomatic,
    date: new Date()
  });

  this.currentAmount += amount;
  this.lastContribution = new Date();

  // Verificar se atingiu a meta
  if (this.currentAmount >= this.targetAmount) {
    this.status = 'completed';
    this.completedAt = new Date();
  }

  return this.save();
};

// Método para remover contribuição
goalSchema.methods.removeContribution = function(contributionId) {
  const contribution = this.contributions.id(contributionId);
  if (!contribution) {
    throw new Error('Contribuição não encontrada');
  }

  this.currentAmount -= contribution.amount;
  this.contributions.pull(contributionId);

  // Se estava completa e agora não está mais
  if (this.status === 'completed' && this.currentAmount < this.targetAmount) {
    this.status = 'active';
    this.completedAt = null;
  }

  return this.save();
};

// Método para adicionar lembrete
goalSchema.methods.addReminder = function(message, date) {
  if (new Date(date) <= new Date()) {
    throw new Error('Data do lembrete deve ser futura');
  }

  this.reminders.push({
    message,
    date: new Date(date)
  });

  return this.save();
};

// Método estático para buscar metas ativas
goalSchema.statics.getActiveGoals = function(userId) {
  return this.find({
    userId,
    status: 'active'
  }).populate('categoryId');
};

// Método estático para lembretes pendentes
goalSchema.statics.getPendingReminders = function() {
  return this.find({
    'reminders.date': { $lte: new Date() },
    'reminders.sent': false,
    status: 'active'
  }).populate('userId');
};

module.exports = mongoose.model('Goal', goalSchema);
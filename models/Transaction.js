// models/Transaction.js - Versão Melhorada
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  description: {
    type: String,
    required: [true, 'Descrição é obrigatória'],
    trim: true,
    maxlength: [100, 'Descrição deve ter no máximo 100 caracteres']
  },
  amount: {
    type: Number,
    required: [true, 'Valor é obrigatório'],
    min: [0.01, 'Valor deve ser maior que zero']
  },
  type: {
    type: String,
    enum: ['income', 'expense'],
    required: [true, 'Tipo é obrigatório']
  },
  // 🔥 MELHORADO: Categoria agora é opcional
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null // Categoria é opcional
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: [true, 'Data é obrigatória'],
    default: Date.now
  },
  notes: {
    type: String,
    maxlength: [500, 'Notas devem ter no máximo 500 caracteres']
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [20, 'Tag deve ter no máximo 20 caracteres']
  }],
  
  // 🔥 NOVO: Campos para recorrência
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringConfig: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'yearly'],
      default: null
    },
    interval: {
      type: Number,
      min: 1,
      default: 1,
      validate: {
        validator: function(value) {
          // Se a transação é recorrente, interval é obrigatório
          if (this.isRecurring && (!value || value < 1)) {
            return false;
          }
          return true;
        },
        message: 'Intervalo deve ser maior que 0 para transações recorrentes'
      }
    },
    endDate: {
      type: Date,
      default: null,
      validate: {
        validator: function(value) {
          // Se há endDate, deve ser maior que a data da transação
          if (value && value <= this.date) {
            return false;
          }
          return true;
        },
        message: 'Data de fim deve ser posterior à data da transação'
      }
    },
    remainingOccurrences: {
      type: Number,
      min: 0,
      default: null
    },
    nextOccurrence: {
      type: Date,
      default: null
    }
  },
  
  // 🔥 NOVO: Para transações filhas geradas por recorrência
  parentTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  },
  isGeneratedFromRecurring: {
    type: Boolean,
    default: false
  },
  
  paymentMethod: {
    type: String,
    enum: ['cash', 'credit_card', 'debit_card', 'bank_transfer', 'pix', 'other'],
    default: 'cash'
  },
  status: {
    type: String,
    enum: ['completed', 'pending', 'cancelled'],
    default: 'completed'
  },
  
  // 🔥 NOVO: Campos para auditoria
  attachment: {
    filename: String,
    url: String,
    size: Number,
    mimeType: String
  },
  location: {
    name: String,
    latitude: Number,
    longitude: Number
  },
  
  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  
  // Sync fields para offline
  syncedAt: {
    type: Date,
    default: Date.now
  },
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 🔥 NOVO: Índices para performance
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, type: 1, date: -1 });
transactionSchema.index({ userId: 1, categoryId: 1, date: -1 });
transactionSchema.index({ userId: 1, isRecurring: 1, 'recurringConfig.nextOccurrence': 1 });
transactionSchema.index({ parentTransactionId: 1 });
transactionSchema.index({ isDeleted: 1, userId: 1 });

// 🔥 NOVO: Virtual para próximas ocorrências
transactionSchema.virtual('nextOccurrences').get(function() {
  if (!this.isRecurring || !this.recurringConfig) return [];
  
  const occurrences = [];
  let currentDate = new Date(this.date);
  const { frequency, interval, endDate, remainingOccurrences } = this.recurringConfig;
  
  const maxOccurrences = remainingOccurrences || 10; // Limite padrão
  
  for (let i = 0; i < Math.min(maxOccurrences, 5); i++) { // Mostrar apenas 5 próximas
    switch (frequency) {
      case 'daily':
        currentDate.setDate(currentDate.getDate() + interval);
        break;
      case 'weekly':
        currentDate.setDate(currentDate.getDate() + (interval * 7));
        break;
      case 'monthly':
        currentDate.setMonth(currentDate.getMonth() + interval);
        break;
      case 'yearly':
        currentDate.setFullYear(currentDate.getFullYear() + interval);
        break;
    }
    
    if (endDate && currentDate > endDate) break;
    
    occurrences.push(new Date(currentDate));
  }
  
  return occurrences;
});

// 🔥 NOVO: Middleware para validação de recorrência
transactionSchema.pre('save', function(next) {
  // Validar configuração de recorrência
  if (this.isRecurring) {
    if (!this.recurringConfig || !this.recurringConfig.frequency) {
      return next(new Error('Configuração de recorrência é obrigatória para transações recorrentes'));
    }
    
    // Calcular próxima ocorrência
    if (!this.recurringConfig.nextOccurrence) {
      this.calculateNextOccurrence();
    }
  } else {
    // Limpar configuração se não é recorrente
    this.recurringConfig = undefined;
  }
  
  next();
});

// 🔥 NOVO: Método para calcular próxima ocorrência
transactionSchema.methods.calculateNextOccurrence = function() {
  if (!this.isRecurring || !this.recurringConfig) return null;
  
  const { frequency, interval } = this.recurringConfig;
  const nextDate = new Date(this.date);
  
  switch (frequency) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + interval);
      break;
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + (interval * 7));
      break;
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + interval);
      break;
    case 'yearly':
      nextDate.setFullYear(nextDate.getFullYear() + interval);
      break;
  }
  
  this.recurringConfig.nextOccurrence = nextDate;
  return nextDate;
};

// 🔥 NOVO: Método para gerar próxima transação recorrente
transactionSchema.methods.generateNextRecurrence = async function() {
  if (!this.isRecurring || !this.recurringConfig) return null;
  
  const { endDate, remainingOccurrences } = this.recurringConfig;
  const nextDate = this.recurringConfig.nextOccurrence;
  
  // Verificar se deve gerar próxima ocorrência
  if (endDate && nextDate > endDate) return null;
  if (remainingOccurrences && remainingOccurrences <= 0) return null;
  
  // Criar nova transação
  const newTransaction = new this.constructor({
    description: this.description,
    amount: this.amount,
    type: this.type,
    categoryId: this.categoryId,
    userId: this.userId,
    date: nextDate,
    notes: this.notes,
    tags: [...this.tags],
    paymentMethod: this.paymentMethod,
    parentTransactionId: this._id,
    isGeneratedFromRecurring: true,
    isRecurring: false // Transações filhas não são recorrentes
  });
  
  await newTransaction.save();
  
  // Atualizar transação pai
  this.calculateNextOccurrence();
  if (this.recurringConfig.remainingOccurrences) {
    this.recurringConfig.remainingOccurrences--;
  }
  await this.save();
  
  return newTransaction;
};

// 🔥 NOVO: Método estático para processar recorrências pendentes
transactionSchema.statics.processRecurringTransactions = async function() {
  const now = new Date();
  
  const recurringTransactions = await this.find({
    isRecurring: true,
    'recurringConfig.nextOccurrence': { $lte: now },
    isDeleted: { $ne: true }
  });
  
  const results = [];
  
  for (const transaction of recurringTransactions) {
    try {
      const newTransaction = await transaction.generateNextRecurrence();
      if (newTransaction) {
        results.push(newTransaction);
      }
    } catch (error) {
      console.error(`Erro ao gerar recorrência para transação ${transaction._id}:`, error);
    }
  }
  
  return results;
};

// 🔥 NOVO: Método para obter estatísticas de recorrência
transactionSchema.statics.getRecurringStats = async function(userId) {
  const stats = await this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), isRecurring: true, isDeleted: { $ne: true } } },
    {
      $group: {
        _id: '$recurringConfig.frequency',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    }
  ]);
  
  return stats;
};

// 🔥 MELHORADO: Query helper para filtrar não deletadas
transactionSchema.query.notDeleted = function() {
  return this.where({ isDeleted: { $ne: true } });
};

// 🔥 MELHORADO: Query helper para incluir categoria
transactionSchema.query.withCategory = function() {
  return this.populate('categoryId', 'name icon color type');
};

module.exports = mongoose.model('Transaction', transactionSchema);
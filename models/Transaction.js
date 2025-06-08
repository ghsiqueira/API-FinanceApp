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
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
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
      default: 1
    },
    endDate: {
      type: Date,
      default: null
    },
    remainingOccurrences: {
      type: Number,
      min: 0,
      default: null
    }
  },
  parentTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  },
  attachment: {
    filename: String,
    url: String,
    size: Number
  },
  location: {
    name: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
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
  syncedAt: {
    type: Date,
    default: Date.now
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      if (ret.isDeleted) {
        delete ret.amount;
        delete ret.description;
      }
      return ret;
    }
  }
});

// Indexes para performance
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, type: 1, date: -1 });
transactionSchema.index({ userId: 1, categoryId: 1, date: -1 });
transactionSchema.index({ userId: 1, isDeleted: 1, date: -1 });
transactionSchema.index({ syncedAt: 1 });

// Middleware para soft delete
transactionSchema.pre(/^find/, function(next) {
  if (!this.getQuery().includeDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// Método para soft delete
transactionSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Método para restaurar
transactionSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = null;
  return this.save();
};

// Método estático para estatísticas
transactionSchema.statics.getStats = async function(userId, startDate, endDate) {
  const match = {
    userId: new mongoose.Types.ObjectId(userId),
    isDeleted: { $ne: true },
    status: 'completed'
  };

  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }

  return await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        income: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'income'] }, '$total', 0]
          }
        },
        expense: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'expense'] }, '$total', 0]
          }
        },
        incomeCount: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'income'] }, '$count', 0]
          }
        },
        expenseCount: {
          $sum: {
            $cond: [{ $eq: ['$_id', 'expense'] }, '$count', 0]
          }
        }
      }
    },
    {
      $project: {
        _id: 0,
        income: 1,
        expense: 1,
        balance: { $subtract: ['$income', '$expense'] },
        incomeCount: 1,
        expenseCount: 1,
        totalTransactions: { $add: ['$incomeCount', '$expenseCount'] }
      }
    }
  ]);
};

module.exports = mongoose.model('Transaction', transactionSchema);
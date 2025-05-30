// models/Transaction.js - VERSÃO ATUALIZADA
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['income', 'expense'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  // NOVOS CAMPOS para transações recorrentes
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringFrequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'yearly'],
    required: function() {
      return this.isRecurring;
    }
  },
  recurringEndDate: {
    type: Date
  },
  recurringParentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }
}, {
  timestamps: true
});

// Índices para otimização
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, type: 1 });
transactionSchema.index({ userId: 1, category: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
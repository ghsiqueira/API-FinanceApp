const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nome da categoria é obrigatório'],
    trim: true,
    maxlength: [30, 'Nome deve ter no máximo 30 caracteres']
  },
  icon: {
    type: String,
    default: 'category'
  },
  color: {
    type: String,
    default: '#3B82F6',
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Cor deve estar no formato hexadecimal']
  },
  type: {
    type: String,
    enum: ['expense', 'income', 'both'],
    default: 'expense'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  description: {
    type: String,
    maxlength: [100, 'Descrição deve ter no máximo 100 caracteres']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
categorySchema.index({ userId: 1, isActive: 1 });
categorySchema.index({ userId: 1, name: 1 }, { unique: true });

// Middleware para criar categorias padrão
categorySchema.statics.createDefaultCategories = async function(userId) {
  const defaultCategories = [
    { name: 'Alimentação', icon: 'restaurant', color: '#FF6B6B', type: 'expense' },
    { name: 'Transporte', icon: 'car', color: '#4ECDC4', type: 'expense' },
    { name: 'Saúde', icon: 'medical', color: '#45B7D1', type: 'expense' },
    { name: 'Educação', icon: 'school', color: '#96CEB4', type: 'expense' },
    { name: 'Lazer', icon: 'game-controller', color: '#FFEAA7', type: 'expense' },
    { name: 'Casa', icon: 'home', color: '#DDA0DD', type: 'expense' },
    { name: 'Roupas', icon: 'shirt', color: '#FFB6C1', type: 'expense' },
    { name: 'Outros Gastos', icon: 'ellipsis-horizontal', color: '#A8A8A8', type: 'expense' },
    { name: 'Salário', icon: 'cash', color: '#00B894', type: 'income' },
    { name: 'Freelance', icon: 'briefcase', color: '#6C5CE7', type: 'income' },
    { name: 'Investimentos', icon: 'trending-up', color: '#FD79A8', type: 'income' },
    { name: 'Outras Receitas', icon: 'add-circle', color: '#74B9FF', type: 'income' }
  ];

  const categories = defaultCategories.map(cat => ({
    ...cat,
    userId,
    isDefault: true
  }));

  return await this.insertMany(categories);
};

module.exports = mongoose.model('Category', categorySchema);
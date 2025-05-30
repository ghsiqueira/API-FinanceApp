const express = require('express');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');
const router = express.Router();

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user._id })
      .sort({ date: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

router.post('/', async (req, res) => {
  try {
    const transaction = new Transaction({
      ...req.body,
      userId: req.user._id
    });
    await transaction.save();
    res.status(201).json(transaction);
  } catch (error) {
    console.log('Erro ao criar transação:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Verificar se a transação existe e pertence ao usuário
    const existingTransaction = await Transaction.findOne({ 
      _id: id, 
      userId: req.user._id 
    });

    if (!existingTransaction) {
      return res.status(404).json({ message: 'Transação não encontrada' });
    }

    // Atualizar a transação
    const transaction = await Transaction.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );
    
    res.json(transaction);
  } catch (error) {
    console.log('Erro ao atualizar transação:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Dados inválidos' });
    }
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!transaction) {
      return res.status(404).json({ message: 'Transação não encontrada' });
    }
    
    res.json({ message: 'Transação deletada com sucesso' });
  } catch (error) {
    console.log('Erro ao deletar transação:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

module.exports = router;
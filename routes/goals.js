// routes/goals.js - VERSÃO ATUALIZADA
const express = require('express');
const Goal = require('../models/Goal');
const auth = require('../middleware/auth');
const router = express.Router();

router.use(auth);

// Obter todas as metas
router.get('/', async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.user._id })
      .sort({ createdAt: -1 });
    res.json(goals);
  } catch (error) {
    console.log('Erro ao buscar metas:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Criar nova meta
router.post('/', async (req, res) => {
  try {
    const { title, targetAmount, targetDate, currentAmount = 0 } = req.body;
    
    // Calcular meta mensal baseada no valor restante
    const remaining = Math.max(0, targetAmount - currentAmount);
    const target = new Date(targetDate);
    const now = new Date();
    
    // CÁLCULO MAIS PRECISO DE MESES
    let monthsDiff = (target.getFullYear() - now.getFullYear()) * 12 + 
                     (target.getMonth() - now.getMonth());
    
    // Se o dia da meta ainda não passou no mês atual, soma 1 mês
    if (target.getDate() > now.getDate()) {
      monthsDiff += 1;
    }
    
    // Garantir pelo menos 1 mês
    monthsDiff = Math.max(monthsDiff, 1);
    
    // Arredondar para 2 casas decimais
    const monthlyTarget = Math.round((remaining / monthsDiff) * 100) / 100;
    
    const goal = new Goal({
      title,
      targetAmount,
      currentAmount,
      targetDate,
      monthlyTarget,
      userId: req.user._id
    });
    
    await goal.save();
    res.status(201).json(goal);
  } catch (error) {
    console.log('Erro ao criar meta:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Dados inválidos' });
    }
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// NOVA ROTA: Atualizar meta
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Verificar se a meta existe e pertence ao usuário
    const existingGoal = await Goal.findOne({ 
      _id: id, 
      userId: req.user._id 
    });

    if (!existingGoal) {
      return res.status(404).json({ message: 'Meta não encontrada' });
    }

    // Se os campos de cálculo foram alterados, recalcular monthlyTarget
    if (updateData.targetAmount || updateData.targetDate || updateData.currentAmount !== undefined) {
      const targetAmount = updateData.targetAmount || existingGoal.targetAmount;
      const targetDate = updateData.targetDate || existingGoal.targetDate;
      const currentAmount = updateData.currentAmount !== undefined ? updateData.currentAmount : existingGoal.currentAmount;
      
      // CALCULAR BASEADO NO VALOR RESTANTE
      const remaining = Math.max(0, targetAmount - currentAmount);
      
      const target = new Date(targetDate);
      const now = new Date();
      
      // CÁLCULO MAIS PRECISO DE MESES
      let monthsDiff = (target.getFullYear() - now.getFullYear()) * 12 + 
                       (target.getMonth() - now.getMonth());
      
      // Se o dia da meta ainda não passou no mês atual, soma 1 mês
      if (target.getDate() > now.getDate()) {
        monthsDiff += 1;
      }
      
      // Garantir pelo menos 1 mês
      monthsDiff = Math.max(monthsDiff, 1);
      
      // Arredondar para 2 casas decimais
      updateData.monthlyTarget = Math.round((remaining / monthsDiff) * 100) / 100;
    }

    // Atualizar a meta
    const goal = await Goal.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );
    
    res.json(goal);
  } catch (error) {
    console.log('Erro ao atualizar meta:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Dados inválidos' });
    }
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Deletar meta
router.delete('/:id', async (req, res) => {
  try {
    const goal = await Goal.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!goal) {
      return res.status(404).json({ message: 'Meta não encontrada' });
    }
    
    res.json({ message: 'Meta deletada com sucesso' });
  } catch (error) {
    console.log('Erro ao deletar meta:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

module.exports = router;
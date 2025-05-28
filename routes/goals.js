const express = require('express');
const Goal = require('../models/Goal');
const auth = require('../middleware/auth');
const router = express.Router();

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.user._id });
    res.json(goals);
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, targetAmount, targetDate } = req.body;
    
    const target = new Date(targetDate);
    const now = new Date();
    const monthsDiff = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
    const monthlyTarget = targetAmount / Math.max(monthsDiff, 1);
    
    const goal = new Goal({
      ...req.body,
      userId: req.user._id,
      monthlyTarget
    });
    
    await goal.save();
    res.status(201).json(goal);
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const goal = await Goal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    
    if (!goal) {
      return res.status(404).json({ message: 'Meta não encontrada' });
    }
    
    res.json(goal);
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const goal = await Goal.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!goal) {
      return res.status(404).json({ message: 'Meta não encontrada' });
    }
    
    res.json({ message: 'Meta deletada' });
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

module.exports = router;
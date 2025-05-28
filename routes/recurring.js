const express = require('express');
const RecurringTransaction = require('../models/RecurringTransaction');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');
const router = express.Router();

router.use(auth);

// Obter todas as transações recorrentes
router.get('/', async (req, res) => {
  try {
    const recurring = await RecurringTransaction.find({ userId: req.user._id })
      .sort({ createdAt: -1 });
    res.json(recurring);
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Criar nova transação recorrente
router.post('/', async (req, res) => {
  try {
    const {
      type,
      amount,
      category,
      description,
      frequency,
      dayOfWeek,
      dayOfMonth,
      dayOfYear,
      startDate,
      endDate,
      maxExecutions
    } = req.body;

    // Calcular próxima execução
    const nextExecution = calculateNextExecution(
      new Date(startDate),
      frequency,
      dayOfWeek,
      dayOfMonth,
      dayOfYear
    );

    const recurringTransaction = new RecurringTransaction({
      userId: req.user._id,
      type,
      amount,
      category,
      description,
      frequency,
      dayOfWeek,
      dayOfMonth,
      dayOfYear,
      startDate,
      endDate,
      maxExecutions,
      nextExecution
    });

    await recurringTransaction.save();
    res.status(201).json(recurringTransaction);
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Atualizar transação recorrente
router.put('/:id', async (req, res) => {
  try {
    const recurring = await RecurringTransaction.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    
    if (!recurring) {
      return res.status(404).json({ message: 'Transação recorrente não encontrada' });
    }
    
    res.json(recurring);
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Deletar transação recorrente
router.delete('/:id', async (req, res) => {
  try {
    const recurring = await RecurringTransaction.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });
    
    if (!recurring) {
      return res.status(404).json({ message: 'Transação recorrente não encontrada' });
    }
    
    res.json({ message: 'Transação recorrente deletada' });
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Executar transações recorrentes pendentes
router.post('/execute', async (req, res) => {
  try {
    const now = new Date();
    const pendingRecurring = await RecurringTransaction.find({
      userId: req.user._id,
      isActive: true,
      nextExecution: { $lte: now },
      $or: [
        { endDate: { $exists: false } },
        { endDate: { $gte: now } }
      ],
      $or: [
        { maxExecutions: { $exists: false } },
        { $expr: { $lt: ['$executionCount', '$maxExecutions'] } }
      ]
    });

    const executedTransactions = [];

    for (const recurring of pendingRecurring) {
      // Criar transação normal
      const transaction = new Transaction({
        userId: recurring.userId,
        type: recurring.type,
        amount: recurring.amount,
        category: recurring.category,
        description: `${recurring.description} (Recorrente)`,
        date: recurring.nextExecution,
        isRecurring: true,
        recurringId: recurring._id
      });

      await transaction.save();
      executedTransactions.push(transaction);

      // Atualizar próxima execução
      const nextExecution = calculateNextExecution(
        recurring.nextExecution,
        recurring.frequency,
        recurring.dayOfWeek,
        recurring.dayOfMonth,
        recurring.dayOfYear
      );

      recurring.lastExecution = recurring.nextExecution;
      recurring.nextExecution = nextExecution;
      recurring.executionCount += 1;

      // Verificar se deve desativar
      if (recurring.maxExecutions && recurring.executionCount >= recurring.maxExecutions) {
        recurring.isActive = false;
      }
      
      if (recurring.endDate && nextExecution > new Date(recurring.endDate)) {
        recurring.isActive = false;
      }

      await recurring.save();
    }

    res.json({ 
      message: `${executedTransactions.length} transações executadas`,
      transactions: executedTransactions
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Função auxiliar para calcular próxima execução
function calculateNextExecution(currentDate, frequency, dayOfWeek, dayOfMonth, dayOfYear) {
  const next = new Date(currentDate);

  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
      
    case 'weekly':
      const daysUntilTarget = (dayOfWeek + 7 - next.getDay()) % 7;
      next.setDate(next.getDate() + (daysUntilTarget || 7));
      break;
      
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      break;
      
    case 'yearly':
      const [month, day] = dayOfYear.split('-');
      next.setFullYear(next.getFullYear() + 1);
      next.setMonth(parseInt(month) - 1);
      next.setDate(parseInt(day));
      break;
  }

  return next;
}

module.exports = router;
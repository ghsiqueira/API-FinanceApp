// routes/auth.js - Versão Corrigida
const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const User = require('../models/User');
const Category = require('../models/Category');
const { generateToken, authenticate } = require('../middleware/auth');
const { 
  sendVerificationEmail, 
  sendPasswordResetEmail, 
  sendWelcomeEmail 
} = require('../utils/email');

const router = express.Router();

// Validações melhoradas
const registerValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Nome deve ter entre 2 e 50 caracteres'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Email inválido'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Senha deve ter no mínimo 6 caracteres'),
  // Adicionar validação de confirmação de senha se necessário
  body('confirmPassword').optional()
    .custom((value, { req }) => {
      if (value && value !== req.body.password) {
        throw new Error('Senhas não conferem');
      }
      return true;
    })
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Email inválido'),
  body('password')
    .notEmpty()
    .withMessage('Senha é obrigatória')
];

// POST /api/auth/register - CORRIGIDO
router.post('/register', registerValidation, async (req, res) => {
  try {
    console.log('📝 Dados recebidos no registro:', {
      name: req.body.name,
      email: req.body.email,
      hasPassword: !!req.body.password,
      hasConfirmPassword: !!req.body.confirmPassword
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Erros de validação:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { name, email, password } = req.body;

    // Verificar se usuário já existe
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('❌ Email já existe:', email);
      return res.status(400).json({
        success: false,
        message: 'Email já está em uso'
      });
    }

    console.log('✅ Email disponível, criando usuário...');

    // Criar usuário
    const user = new User({ name, email, password });
    
    // Gerar token de verificação
    const verificationToken = user.generateEmailVerificationToken();
    await user.save();

    console.log('✅ Usuário salvo com ID:', user._id);

    // Criar categorias padrão
    try {
      await Category.createDefaultCategories(user._id);
      console.log('✅ Categorias padrão criadas');
    } catch (catError) {
      console.log('⚠️ Erro ao criar categorias (não crítico):', catError.message);
    }

    // Enviar email de verificação (opcional)
    try {
      await sendVerificationEmail(email, name, verificationToken);
      console.log('✅ Email de verificação enviado');
    } catch (emailError) {
      console.log('⚠️ Erro ao enviar email (não crítico):', emailError.message);
    }

    // Resposta padronizada
    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso! Verifique seu email para ativar a conta.',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          isEmailVerified: user.isEmailVerified,
          theme: user.theme || 'light',
          currency: user.currency || 'BRL',
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      }
    });

  } catch (error) {
    console.error('❌ Erro crítico no registro:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      ...(process.env.NODE_ENV === 'development' && { 
        debug: error.message 
      })
    });
  }
});

// POST /api/auth/login - CORRIGIDO
router.post('/login', loginValidation, async (req, res) => {
  try {
    console.log('🔐 Tentativa de login para:', req.body.email);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Erros de validação no login:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Buscar usuário com senha
    const user = await User.findOne({ 
      email, 
      isActive: true 
    }).select('+password');

    if (!user) {
      console.log('❌ Usuário não encontrado:', email);
      return res.status(401).json({
        success: false,
        message: 'Email ou senha incorretos'
      });
    }

    // Verificar senha
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log('❌ Senha incorreta para:', email);
      return res.status(401).json({
        success: false,
        message: 'Email ou senha incorretos'
      });
    }

    console.log('✅ Login válido, gerando token...');

    // Gerar token
    const token = generateToken(user._id);

    // Atualizar último login
    user.lastLogin = new Date();
    await user.save();

    console.log('✅ Token gerado e usuário atualizado');

    // Resposta padronizada
    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          isEmailVerified: user.isEmailVerified,
          theme: user.theme || 'light',
          currency: user.currency || 'BRL',
          preferences: user.preferences || {
            language: 'pt-BR',
            notifications: {
              email: true,
              budgetAlerts: true,
              goalReminders: true
            }
          },
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      }
    });

  } catch (error) {
    console.error('❌ Erro crítico no login:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      ...(process.env.NODE_ENV === 'development' && { 
        debug: error.message 
      })
    });
  }
});

// Adicionar rota de teste de conexão
router.get('/test-connection', (req, res) => {
  res.json({
    success: true,
    message: 'Servidor funcionando',
    timestamp: new Date().toISOString(),
    data: {
      status: 'online',
      version: '1.0.0'
    }
  });
});

// Resto das rotas...
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email é obrigatório'
      });
    }

    const user = await User.findOne({ email, isActive: true });
    if (!user) {
      // Por segurança, não revelar se o email existe
      return res.json({
        success: true,
        message: 'Se o email existir, você receberá instruções para redefinir sua senha.'
      });
    }

    const resetToken = user.generatePasswordResetToken();
    await user.save();

    await sendPasswordResetEmail(email, user.name, resetToken);

    res.json({
      success: true,
      message: 'Instruções enviadas para seu email.'
    });

  } catch (error) {
    console.error('Erro no forgot password:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token e senha são obrigatórios'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Senha deve ter no mínimo 6 caracteres'
      });
    }

    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Token inválido ou expirado'
      });
    }

    user.password = password;
    user.clearTokens();
    await user.save();

    res.json({
      success: true,
      message: 'Senha redefinida com sucesso!'
    });

  } catch (error) {
    console.error('Erro no reset de senha:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user
      }
    });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/logout', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logout realizado com sucesso'
    });
  } catch (error) {
    console.error('Erro no logout:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
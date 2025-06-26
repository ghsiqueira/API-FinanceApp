const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware para verificar se usuário está autenticado
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de acesso necessário'
      });
    }

    // Verificar se JWT_SECRET existe
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET não definido no .env');
      return res.status(500).json({
        success: false,
        message: 'Erro de configuração do servidor'
      });
    }

    // Usar JWT padrão se não houver sistema de rotação
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.error('❌ Erro ao verificar token:', jwtError.message);
      return res.status(401).json({
        success: false,
        message: 'Token inválido'
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não encontrado ou inativo'
      });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    console.error('❌ Erro na autenticação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
};

// Middleware opcional - não falha se não houver token
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (user && user.isActive) {
          req.user = user;
          req.userId = user._id;
        }
      } catch (error) {
        // Ignora erros de token para auth opcional
        console.log('Token opcional inválido, continuando sem autenticação');
      }
    }
    next();
  } catch (error) {
    // Ignora erros de token para auth opcional
    next();
  }
};

// Middleware para verificar se email foi verificado
const requireEmailVerification = (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email não verificado. Verifique seu email antes de continuar.',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  next();
};

// Função para gerar token JWT (usa JWT_SECRET padrão)
const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não definido');
  }
  
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// Função para verificar token sem middleware
const verifyToken = (token) => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET não definido');
    }
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.error('❌ Erro ao verificar token:', error.message);
    return null;
  }
};

// Log para debug - verificar se middleware está sendo carregado
console.log('✅ Middleware auth carregado com sucesso');

module.exports = {
  authenticate,
  optionalAuth,
  requireEmailVerification,
  generateToken,
  verifyToken
};
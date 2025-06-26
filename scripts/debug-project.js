// debug-project.js - Script de Diagnóstico Completo (versão para pasta scripts)
const mongoose = require('mongoose');
const path = require('path');

// CORREÇÃO: Carrega o .env da pasta pai (raiz do projeto)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('🔍 INICIANDO DIAGNÓSTICO COMPLETO DO PROJETO...\n');

async function debugProject() {
  try {
    // 1. Verificar variáveis de ambiente
    console.log('1️⃣ VERIFICANDO VARIÁVEIS DE AMBIENTE:');
    const requiredEnvVars = ['JWT_SECRET', 'MONGODB_URI', 'JWT_EXPIRE'];
    
    requiredEnvVars.forEach(envVar => {
      if (process.env[envVar]) {
        console.log(`✅ ${envVar}: definido`);
      } else {
        console.log(`❌ ${envVar}: NÃO DEFINIDO`);
      }
    });
    console.log('');

    // 2. Testar conexão com MongoDB
    console.log('2️⃣ TESTANDO CONEXÃO COM MONGODB:');
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ Conectado ao MongoDB com sucesso');
      
      // Listar collections
      const collections = await mongoose.connection.db.listCollections().toArray();
      console.log('📋 Collections encontradas:', collections.map(c => c.name).join(', '));
      
    } catch (error) {
      console.log('❌ Erro ao conectar ao MongoDB:', error.message);
      return;
    }
    console.log('');

    // 3. Verificar modelos
    console.log('3️⃣ TESTANDO MODELOS:');
    const modelFiles = ['User', 'Transaction', 'Category', 'Budget', 'Goal'];
    
    for (const modelName of modelFiles) {
      try {
        const Model = require(path.join(__dirname, '..', 'models', modelName));
        const count = await Model.countDocuments();
        console.log(`✅ ${modelName}: ${count} documentos`);
      } catch (error) {
        console.log(`❌ ${modelName}: erro ao carregar - ${error.message}`);
      }
    }
    console.log('');

    // 4. Testar middleware de autenticação
    console.log('4️⃣ TESTANDO MIDDLEWARE:');
    try {
      const authModule = require(path.join(__dirname, '..', 'middleware', 'auth'));
      console.log('✅ Middleware auth carregado');
      console.log('📋 Exports:', Object.keys(authModule));
      
      if (typeof authModule.authenticate === 'function') {
        console.log('✅ authenticate é uma função');
      } else {
        console.log('❌ authenticate não é uma função');
      }
    } catch (error) {
      console.log('❌ Erro ao carregar middleware:', error.message);
    }
    console.log('');

    // 5. Testar rotas
    console.log('5️⃣ TESTANDO ROTAS:');
    const routeFiles = ['auth', 'transactions', 'categories', 'budgets', 'goals', 'user'];
    
    routeFiles.forEach(routeName => {
      try {
        require(path.join(__dirname, '..', 'routes', routeName));
        console.log(`✅ Rota ${routeName} carregada`);
      } catch (error) {
        console.log(`❌ Rota ${routeName}: ${error.message}`);
        if (error.stack) {
          console.log('   Stack:', error.stack.split('\n')[1]?.trim());
        }
      }
    });
    console.log('');

    // 6. Testar criação de usuário de teste
    console.log('6️⃣ TESTANDO CRIAÇÃO DE DADOS DE TESTE:');
    try {
      const User = require(path.join(__dirname, '..', 'models', 'User'));
      const Category = require(path.join(__dirname, '..', 'models', 'Category'));
      const Transaction = require(path.join(__dirname, '..', 'models', 'Transaction'));

      // Verificar se já existe usuário de teste
      let testUser = await User.findOne({ email: 'teste@exemplo.com' });
      
      if (!testUser) {
        testUser = new User({
          name: 'Usuário Teste',
          email: 'teste@exemplo.com',
          password: '123456',
          isEmailVerified: true
        });
        await testUser.save();
        console.log('✅ Usuário de teste criado');

        // Criar categorias padrão
        await Category.createDefaultCategories(testUser._id);
        console.log('✅ Categorias padrão criadas');
      } else {
        console.log('✅ Usuário de teste já existe');
      }

      // Verificar categorias
      const categoryCount = await Category.countDocuments({ userId: testUser._id });
      console.log(`✅ ${categoryCount} categorias encontradas para o usuário teste`);

      // Verificar transações
      const transactionCount = await Transaction.countDocuments({ userId: testUser._id });
      console.log(`✅ ${transactionCount} transações encontradas para o usuário teste`);

    } catch (error) {
      console.log('❌ Erro ao criar dados de teste:', error.message);
    }
    console.log('');

    // 7. Testar query de transações
    console.log('7️⃣ TESTANDO QUERY DE TRANSAÇÕES:');
    try {
      const User = require(path.join(__dirname, '..', 'models', 'User'));
      const Transaction = require(path.join(__dirname, '..', 'models', 'Transaction'));
      
      const testUser = await User.findOne({ email: 'teste@exemplo.com' });
      if (testUser) {
        const filters = { 
          userId: testUser._id,
          isDeleted: { $ne: true }
        };

        const transactions = await Transaction.find(filters)
          .populate('categoryId', 'name icon color type')
          .sort({ date: -1 })
          .limit(5);

        console.log(`✅ Query de transações executada com sucesso - ${transactions.length} resultados`);
        
        if (transactions.length > 0) {
          console.log('📋 Primeira transação:', {
            id: transactions[0]._id,
            description: transactions[0].description,
            amount: transactions[0].amount,
            type: transactions[0].type,
            category: transactions[0].categoryId?.name || 'Sem categoria'
          });
        }
      }
    } catch (error) {
      console.log('❌ Erro na query de transações:', error.message);
      console.log('   Stack:', error.stack?.split('\n')?.[1]?.trim());
    }
    console.log('');

    // 8. Testar JWT
    console.log('8️⃣ TESTANDO JWT:');
    try {
      const { generateToken, verifyToken } = require(path.join(__dirname, '..', 'middleware', 'auth'));
      const testUserId = '507f1f77bcf86cd799439011'; // ObjectId válido de teste
      
      const token = generateToken(testUserId);
      console.log('✅ Token gerado com sucesso');
      
      const decoded = verifyToken(token);
      if (decoded && decoded.userId === testUserId) {
        console.log('✅ Token verificado com sucesso');
      } else {
        console.log('❌ Erro ao verificar token');
      }
    } catch (error) {
      console.log('❌ Erro no JWT:', error.message);
    }

    console.log('\n🎉 DIAGNÓSTICO CONCLUÍDO!\n');

  } catch (error) {
    console.log('❌ ERRO GERAL NO DIAGNÓSTICO:', error.message);
    console.log('Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Desconectado do MongoDB');
  }
}

// Executar diagnóstico
debugProject().catch(console.error);
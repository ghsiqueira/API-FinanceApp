#!/usr/bin/env node

// scripts/test-api.js
const https = require('https');
const http = require('http');

class APITester {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.token = null;
    this.userId = null;
    this.categoryId = null;
    this.transactionId = null;
    this.budgetId = null;
    this.goalId = null;
  }

  async makeRequest(method, path, data = null, useAuth = false) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'API-Tester/1.0'
        }
      };

      if (useAuth && this.token) {
        options.headers['Authorization'] = `Bearer ${this.token}`;
      }

      if (data) {
        const jsonData = JSON.stringify(data);
        options.headers['Content-Length'] = Buffer.byteLength(jsonData);
      }

      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const parsedData = JSON.parse(responseData);
            resolve({
              status: res.statusCode,
              data: parsedData,
              headers: res.headers
            });
          } catch (error) {
            resolve({
              status: res.statusCode,
              data: responseData,
              headers: res.headers
            });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  log(emoji, message, data = null) {
    console.log(`${emoji} ${message}`);
    if (data) {
      console.log('   Resposta:', JSON.stringify(data, null, 2));
    }
    console.log('');
  }

  async testHealthCheck() {
    console.log('🏥 TESTANDO HEALTH CHECK');
    console.log('='.repeat(50));
    
    try {
      const response = await this.makeRequest('GET', '/api/health');
      
      if (response.status === 200) {
        this.log('✅', 'Health check funcionando', response.data);
        return true;
      } else {
        this.log('❌', `Health check falhou - Status: ${response.status}`, response.data);
        return false;
      }
    } catch (error) {
      this.log('❌', 'Erro no health check', error.message);
      return false;
    }
  }

  async testAuth() {
    console.log('🔐 TESTANDO AUTENTICAÇÃO');
    console.log('='.repeat(50));

    // 1. Registrar usuário
    try {
      const registerData = {
        name: 'Teste Usuario',
        email: `teste${Date.now()}@exemplo.com`,
        password: '123456'
      };

      const registerResponse = await this.makeRequest('POST', '/api/auth/register', registerData);
      
      if (registerResponse.status === 201) {
        this.log('✅', 'Registro funcionando', registerResponse.data);
        this.userId = registerResponse.data.data?.user?.id;
      } else {
        this.log('❌', `Registro falhou - Status: ${registerResponse.status}`, registerResponse.data);
        return false;
      }

      // 2. Login
      const loginData = {
        email: registerData.email,
        password: registerData.password
      };

      const loginResponse = await this.makeRequest('POST', '/api/auth/login', loginData);
      
      if (loginResponse.status === 200) {
        this.log('✅', 'Login funcionando', loginResponse.data);
        this.token = loginResponse.data.data?.token;
        return true;
      } else {
        this.log('❌', `Login falhou - Status: ${loginResponse.status}`, loginResponse.data);
        return false;
      }

    } catch (error) {
      this.log('❌', 'Erro na autenticação', error.message);
      return false;
    }
  }

  async testUser() {
    console.log('👤 TESTANDO ROTAS DE USUÁRIO');
    console.log('='.repeat(50));

    try {
      // Profile
      const profileResponse = await this.makeRequest('GET', '/api/user/profile', null, true);
      
      if (profileResponse.status === 200) {
        this.log('✅', 'Profile funcionando', profileResponse.data);
      } else {
        this.log('❌', `Profile falhou - Status: ${profileResponse.status}`, profileResponse.data);
      }

      // Dashboard
      const dashboardResponse = await this.makeRequest('GET', '/api/user/dashboard', null, true);
      
      if (dashboardResponse.status === 200) {
        this.log('✅', 'Dashboard funcionando', dashboardResponse.data);
      } else {
        this.log('❌', `Dashboard falhou - Status: ${dashboardResponse.status}`, dashboardResponse.data);
      }

      // Stats
      const statsResponse = await this.makeRequest('GET', '/api/user/stats', null, true);
      
      if (statsResponse.status === 200) {
        this.log('✅', 'Stats funcionando', statsResponse.data);
        return true;
      } else {
        this.log('❌', `Stats falhou - Status: ${statsResponse.status}`, statsResponse.data);
        return false;
      }

    } catch (error) {
      this.log('❌', 'Erro nas rotas de usuário', error.message);
      return false;
    }
  }

  async testCategories() {
    console.log('📂 TESTANDO CATEGORIAS');
    console.log('='.repeat(50));

    try {
      // Listar categorias
      const listResponse = await this.makeRequest('GET', '/api/categories', null, true);
      
      if (listResponse.status === 200) {
        this.log('✅', 'Listar categorias funcionando', listResponse.data);
        
        // Pegar uma categoria para usar nos testes
        if (listResponse.data.data?.categories?.length > 0) {
          this.categoryId = listResponse.data.data.categories[0]._id;
        }
      } else {
        this.log('❌', `Listar categorias falhou - Status: ${listResponse.status}`, listResponse.data);
      }

      // Criar categoria
      const createData = {
        name: `Categoria Teste ${Date.now()}`,
        icon: 'test',
        color: '#FF0000',
        type: 'expense'
      };

      const createResponse = await this.makeRequest('POST', '/api/categories', createData, true);
      
      if (createResponse.status === 201) {
        this.log('✅', 'Criar categoria funcionando', createResponse.data);
        this.categoryId = createResponse.data.data?.category?._id;
        return true;
      } else {
        this.log('❌', `Criar categoria falhou - Status: ${createResponse.status}`, createResponse.data);
        return false;
      }

    } catch (error) {
      this.log('❌', 'Erro nas categorias', error.message);
      return false;
    }
  }

  async testTransactions() {
    console.log('💰 TESTANDO TRANSAÇÕES');
    console.log('='.repeat(50));

    try {
      // Criar transação
      const createData = {
        description: 'Transação de teste',
        amount: 100.50,
        type: 'expense',
        categoryId: this.categoryId,
        date: new Date().toISOString()
      };

      const createResponse = await this.makeRequest('POST', '/api/transactions', createData, true);
      
      if (createResponse.status === 201) {
        this.log('✅', 'Criar transação funcionando', createResponse.data);
        this.transactionId = createResponse.data.data?.transaction?._id;
      } else {
        this.log('❌', `Criar transação falhou - Status: ${createResponse.status}`, createResponse.data);
      }

      // Listar transações
      const listResponse = await this.makeRequest('GET', '/api/transactions', null, true);
      
      if (listResponse.status === 200) {
        this.log('✅', 'Listar transações funcionando', listResponse.data);
      } else {
        this.log('❌', `Listar transações falhou - Status: ${listResponse.status}`, listResponse.data);
      }

      // Stats de transações
      const statsResponse = await this.makeRequest('GET', '/api/transactions/stats', null, true);
      
      if (statsResponse.status === 200) {
        this.log('✅', 'Stats de transações funcionando', statsResponse.data);
        return true;
      } else {
        this.log('❌', `Stats de transações falhou - Status: ${statsResponse.status}`, statsResponse.data);
        return false;
      }

    } catch (error) {
      this.log('❌', 'Erro nas transações', error.message);
      return false;
    }
  }

  async testBudgets() {
    console.log('💳 TESTANDO ORÇAMENTOS');
    console.log('='.repeat(50));

    try {
      // Criar orçamento
      const createData = {
        name: 'Orçamento Teste',
        amount: 500.00,
        categoryId: this.categoryId,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };

      const createResponse = await this.makeRequest('POST', '/api/budgets', createData, true);
      
      if (createResponse.status === 201) {
        this.log('✅', 'Criar orçamento funcionando', createResponse.data);
        this.budgetId = createResponse.data.data?.budget?._id;
      } else {
        this.log('❌', `Criar orçamento falhou - Status: ${createResponse.status}`, createResponse.data);
      }

      // Listar orçamentos
      const listResponse = await this.makeRequest('GET', '/api/budgets', null, true);
      
      if (listResponse.status === 200) {
        this.log('✅', 'Listar orçamentos funcionando', listResponse.data);
        return true;
      } else {
        this.log('❌', `Listar orçamentos falhou - Status: ${listResponse.status}`, listResponse.data);
        return false;
      }

    } catch (error) {
      this.log('❌', 'Erro nos orçamentos', error.message);
      return false;
    }
  }

  async testGoals() {
    console.log('🎯 TESTANDO METAS');
    console.log('='.repeat(50));

    try {
      // Criar meta
      const createData = {
        title: 'Meta Teste',
        targetAmount: 1000.00,
        targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        description: 'Uma meta de teste'
      };

      const createResponse = await this.makeRequest('POST', '/api/goals', createData, true);
      
      if (createResponse.status === 201) {
        this.log('✅', 'Criar meta funcionando', createResponse.data);
        this.goalId = createResponse.data.data?.goal?._id;
      } else {
        this.log('❌', `Criar meta falhou - Status: ${createResponse.status}`, createResponse.data);
      }

      // Listar metas
      const listResponse = await this.makeRequest('GET', '/api/goals', null, true);
      
      if (listResponse.status === 200) {
        this.log('✅', 'Listar metas funcionando', listResponse.data);
        return true;
      } else {
        this.log('❌', `Listar metas falhou - Status: ${listResponse.status}`, listResponse.data);
        return false;
      }

    } catch (error) {
      this.log('❌', 'Erro nas metas', error.message);
      return false;
    }
  }

  async runAllTests() {
    console.log('🧪 INICIANDO TESTES COMPLETOS DA API');
    console.log('='.repeat(70));
    console.log('');

    const results = {
      health: false,
      auth: false,
      user: false,
      categories: false,
      transactions: false,
      budgets: false,
      goals: false
    };

    // Executar testes em sequência
    results.health = await this.testHealthCheck();
    
    if (results.health) {
      results.auth = await this.testAuth();
      
      if (results.auth) {
        results.user = await this.testUser();
        results.categories = await this.testCategories();
        
        if (results.categories) {
          results.transactions = await this.testTransactions();
          results.budgets = await this.testBudgets();
        }
        
        results.goals = await this.testGoals();
      }
    }

    // Relatório final
    console.log('📊 RELATÓRIO FINAL');
    console.log('='.repeat(50));
    
    const tests = [
      { name: 'Health Check', passed: results.health },
      { name: 'Autenticação', passed: results.auth },
      { name: 'Usuário', passed: results.user },
      { name: 'Categorias', passed: results.categories },
      { name: 'Transações', passed: results.transactions },
      { name: 'Orçamentos', passed: results.budgets },
      { name: 'Metas', passed: results.goals }
    ];

    const passedTests = tests.filter(t => t.passed).length;
    const totalTests = tests.length;

    tests.forEach(test => {
      const emoji = test.passed ? '✅' : '❌';
      console.log(`${emoji} ${test.name}`);
    });

    console.log('');
    console.log(`📈 Resultado: ${passedTests}/${totalTests} testes passaram`);
    
    if (passedTests === totalTests) {
      console.log('🎉 TODOS OS TESTES PASSARAM! API está funcionando perfeitamente!');
    } else {
      console.log('⚠️ Alguns testes falharam. Verifique os logs acima.');
    }

    return passedTests === totalTests;
  }
}

// Executar testes se chamado diretamente
if (require.main === module) {
  const tester = new APITester();
  tester.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Erro fatal nos testes:', error);
      process.exit(1);
    });
}

module.exports = APITester;
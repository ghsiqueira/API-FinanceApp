// scripts/quick-jwt-gen.js - Versão Corrigida
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');

console.log('🔍 Verificando JWT secret...');

// Ler arquivo .env atual
let envContent = '';
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
}

// Verificar se já existe um JWT_SECRET válido
const jwtSecretMatch = envContent.match(/^JWT_SECRET=(.+)$/m);

if (jwtSecretMatch && jwtSecretMatch[1] && jwtSecretMatch[1].length >= 32) {
  console.log('✅ JWT_SECRET já existe e é válido');
  console.log('🔑 Secret atual:', jwtSecretMatch[1].substring(0, 20) + '...');
  console.log('📏 Tamanho:', jwtSecretMatch[1].length, 'caracteres');
  console.log('🚀 Usando JWT secret existente!');
} else {
  console.log('🔑 Gerando novo JWT secret para desenvolvimento...');
  
  // Gerar novo secret apenas se não existir um válido
  const jwtSecret = crypto.randomBytes(64).toString('hex');
  
  // Atualizar ou adicionar JWT_SECRET no .env
  if (jwtSecretMatch) {
    // Substituir secret existente
    envContent = envContent.replace(/^JWT_SECRET=.+$/m, `JWT_SECRET=${jwtSecret}`);
  } else {
    // Adicionar novo secret
    if (!envContent.includes('JWT_SECRET=')) {
      envContent += `\nJWT_SECRET=${jwtSecret}`;
    }
  }
  
  // Salvar arquivo .env
  fs.writeFileSync(envPath, envContent);
  
  console.log('✅ JWT_SECRET atualizado no .env');
  console.log('🔑 Novo secret:', jwtSecret.substring(0, 20) + '...');
  console.log('📏 Tamanho:', jwtSecret.length, 'caracteres');
  console.log('🚀 JWT secret gerado e aplicado com sucesso!');
}
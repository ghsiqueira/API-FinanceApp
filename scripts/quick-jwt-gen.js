const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🔑 Gerando novo JWT secret para desenvolvimento...');

function generateJWTSecret() {
  // Gerar secret de 64 bytes (128 caracteres hex)
  return crypto.randomBytes(64).toString('hex');
}

function updateEnvFile() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    
    // Verificar se .env existe
    if (!fs.existsSync(envPath)) {
      console.log('❌ Arquivo .env não encontrado!');
      process.exit(1);
    }
    
    // Ler conteúdo atual
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // Gerar novo secret
    const newSecret = generateJWTSecret();
    
    // Substituir JWT_SECRET existente
    const jwtSecretRegex = /^JWT_SECRET=.*$/gm;
    
    if (jwtSecretRegex.test(envContent)) {
      // Substituir linha existente
      envContent = envContent.replace(jwtSecretRegex, `JWT_SECRET=${newSecret}`);
      console.log('✅ JWT_SECRET atualizado no .env');
    } else {
      // Se não existe, adicionar na seção JWT
      const jwtSectionRegex = /^# JWT$/gm;
      if (jwtSectionRegex.test(envContent)) {
        envContent = envContent.replace(
          /^# JWT$/gm, 
          `# JWT\nJWT_SECRET=${newSecret}`
        );
        console.log('✅ JWT_SECRET adicionado na seção JWT');
      } else {
        // Adicionar no final
        envContent += `\n# JWT\nJWT_SECRET=${newSecret}`;
        console.log('✅ JWT_SECRET adicionado no final do .env');
      }
    }
    
    // Escrever arquivo atualizado
    fs.writeFileSync(envPath, envContent, 'utf8');
    
    console.log(`🔑 Novo secret: ${newSecret.substring(0, 16)}...`);
    console.log(`📏 Tamanho: ${newSecret.length} caracteres`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Erro ao atualizar .env:', error.message);
    return false;
  }
}

// Executar geração
if (updateEnvFile()) {
  console.log('🚀 JWT secret gerado e aplicado com sucesso!');
} else {
  console.log('❌ Falha ao gerar JWT secret');
  process.exit(1);
}

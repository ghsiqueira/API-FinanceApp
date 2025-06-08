const nodemailer = require('nodemailer');

// Configurar transporter
const createTransporter = () => {
  return nodemailer.createTransport({  // ← CORRIGIDO: createTransport (sem "er")
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    secure: process.env.MAIL_ENCRYPTION === 'ssl',
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

// Template base para emails
const getEmailTemplate = (title, content, buttonText = null, buttonUrl = null) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          line-height: 1.6; 
          color: #333; 
          max-width: 600px; 
          margin: 0 auto; 
          padding: 20px; 
        }
        .header { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
          color: white; 
          padding: 30px; 
          text-align: center; 
          border-radius: 10px 10px 0 0; 
        }
        .content { 
          background: #f9f9f9; 
          padding: 30px; 
          border-radius: 0 0 10px 10px; 
        }
        .button { 
          display: inline-block; 
          background: #667eea; 
          color: white; 
          padding: 12px 30px; 
          text-decoration: none; 
          border-radius: 5px; 
          margin: 20px 0; 
        }
        .footer { 
          text-align: center; 
          margin-top: 20px; 
          font-size: 12px; 
          color: #666; 
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>💰 Finance App</h1>
        <h2>${title}</h2>
      </div>
      <div class="content">
        ${content}
        ${buttonText && buttonUrl ? `
          <div style="text-align: center;">
            <a href="${buttonUrl}" class="button">${buttonText}</a>
          </div>
        ` : ''}
      </div>
      <div class="footer">
        <p>© 2025 Finance App. Todos os direitos reservados.</p>
        <p>Este é um email automático, não responda.</p>
      </div>
    </body>
    </html>
  `;
};

// Enviar email de verificação
const sendVerificationEmail = async (email, name, token) => {
  try {
    const transporter = createTransporter();
    
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    
    const content = `
      <h3>Olá, ${name}!</h3>
      <p>Obrigado por se cadastrar no Finance App! Para começar a usar nossa plataforma, você precisa verificar seu email.</p>
      <p>Clique no botão abaixo para verificar sua conta:</p>
    `;

    const mailOptions = {
      from: `"Finance App" <${process.env.MAIL_FROM_ADDRESS}>`,
      to: email,
      subject: 'Verificação de Email - Finance App',
      html: getEmailTemplate('Verificação de Email', content, 'Verificar Email', verificationUrl)
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email de verificação enviado para: ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Erro ao enviar email de verificação:', error);
    return { success: false, error: error.message };
  }
};

// Enviar email de reset de senha
const sendPasswordResetEmail = async (email, name, token) => {
  try {
    const transporter = createTransporter();
    
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    const content = `
      <h3>Olá, ${name}!</h3>
      <p>Você solicitou uma redefinição de senha para sua conta no Finance App.</p>
      <p>Clique no botão abaixo para redefinir sua senha:</p>
      <p><strong>Este link expira em 30 minutos por segurança.</strong></p>
      <p>Se você não solicitou esta redefinição, ignore este email.</p>
    `;

    const mailOptions = {
      from: `"Finance App" <${process.env.MAIL_FROM_ADDRESS}>`,
      to: email,
      subject: 'Redefinição de Senha - Finance App',
      html: getEmailTemplate('Redefinição de Senha', content, 'Redefinir Senha', resetUrl)
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email de reset de senha enviado para: ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Erro ao enviar email de reset:', error);
    return { success: false, error: error.message };
  }
};

// Enviar email de boas-vindas
const sendWelcomeEmail = async (email, name) => {
  try {
    const transporter = createTransporter();
    
    const content = `
      <h3>Bem-vindo(a), ${name}!</h3>
      <p>Sua conta foi verificada com sucesso! 🎉</p>
      <p>Agora você pode aproveitar todas as funcionalidades do Finance App:</p>
      <ul>
        <li>📊 Controle suas receitas e gastos</li>
        <li>🎯 Defina e acompanhe suas metas financeiras</li>
        <li>💰 Gerencie orçamentos por categoria</li>
        <li>📱 Acesse offline e sincronize quando online</li>
      </ul>
      <p>Comece agora mesmo a organizar suas finanças!</p>
    `;

    const mailOptions = {
      from: `"Finance App" <${process.env.MAIL_FROM_ADDRESS}>`,
      to: email,
      subject: 'Bem-vindo ao Finance App! 🎉',
      html: getEmailTemplate('Bem-vindo!', content, 'Começar Agora', process.env.FRONTEND_URL)
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email de boas-vindas enviado para: ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Erro ao enviar email de boas-vindas:', error);
    return { success: false, error: error.message };
  }
};

// Enviar alerta de orçamento
const sendBudgetAlert = async (email, name, budgetName, spent, limit, percentage) => {
  try {
    const transporter = createTransporter();
    
    const content = `
      <h3>Olá, ${name}!</h3>
      <p>⚠️ <strong>Alerta de Orçamento!</strong></p>
      <p>Seu orçamento "${budgetName}" atingiu ${percentage}% do limite.</p>
      <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
        <p><strong>Gasto atual:</strong> R$ ${spent.toFixed(2)}</p>
        <p><strong>Limite:</strong> R$ ${limit.toFixed(2)}</p>
        <p><strong>Restante:</strong> R$ ${(limit - spent).toFixed(2)}</p>
      </div>
      <p>Que tal revisar seus gastos para manter o controle? 💡</p>
    `;

    const mailOptions = {
      from: `"Finance App" <${process.env.MAIL_FROM_ADDRESS}>`,
      to: email,
      subject: `⚠️ Alerta de Orçamento: ${budgetName}`,
      html: getEmailTemplate('Alerta de Orçamento', content, 'Ver Detalhes', `${process.env.FRONTEND_URL}/budgets`)
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Alerta de orçamento enviado para: ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Erro ao enviar alerta de orçamento:', error);
    return { success: false, error: error.message };
  }
};

// Enviar lembrete de meta
const sendGoalReminder = async (email, name, goalTitle, message) => {
  try {
    const transporter = createTransporter();
    
    const content = `
      <h3>Olá, ${name}!</h3>
      <p>🎯 <strong>Lembrete da sua meta "${goalTitle}"</strong></p>
      <p>${message}</p>
      <p>Continue focado nos seus objetivos financeiros! 💪</p>
    `;

    const mailOptions = {
      from: `"Finance App" <${process.env.MAIL_FROM_ADDRESS}>`,
      to: email,
      subject: `🎯 Lembrete: ${goalTitle}`,
      html: getEmailTemplate('Lembrete de Meta', content, 'Ver Meta', `${process.env.FRONTEND_URL}/goals`)
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Lembrete de meta enviado para: ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Erro ao enviar lembrete de meta:', error);
    return { success: false, error: error.message };
  }
};

// Testar configuração de email
const testEmailConfig = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('✅ Configuração de email válida');
    return true;
  } catch (error) {
    console.error('❌ Erro na configuração de email:', error);
    return false;
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendBudgetAlert,
  sendGoalReminder,
  testEmailConfig
};
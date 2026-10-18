const API_BASE = 'https://api.blackcatoficial.com/api';

const PRODUCT = Object.freeze({
  name: '#MBA - TURMA 5 (09/26)',
  description: 'MBA Reforma Tributária & Gestão Tributária - Turma 5 (09/26)',
  amount: 59940,
  currency: 'BRL'
});

function digits(value = '') {
  return String(value).replace(/\D/g, '');
}

function validEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function normalizePhone(value = '') {
  let phone = digits(value);
  if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) {
    phone = phone.slice(2);
  }
  return phone;
}

function normalizeStudent(input = {}) {
  return {
    name: String(input.name || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    phone: normalizePhone(input.phone),
    taxId: digits(input.taxId)
  };
}

function normalizeAddress(input = {}) {
  return {
    zipCode: digits(input.zipCode),
    street: String(input.street || '').trim(),
    number: String(input.number || '').trim(),
    city: String(input.city || '').trim(),
    district: String(input.district || '').trim(),
    complement: String(input.complement || '').trim(),
    state: String(input.state || '').trim().toUpperCase()
  };
}

function validateStudent(student) {
  if (student.name.length < 3 || !student.name.includes(' ')) return 'Informe o nome completo do aluno.';
  if (!validEmail(student.email)) return 'Informe um e-mail válido.';
  if (student.phone.length !== 10 && student.phone.length !== 11) return 'Informe um telefone válido com DDD.';
  if (student.taxId.length !== 11 && student.taxId.length !== 14) return 'Informe um CPF/CNPJ válido.';
  return '';
}

function validateAddress(address) {
  if (address.zipCode.length !== 8) return 'Informe um CEP válido.';
  if (!address.street) return 'Informe o endereço.';
  if (!address.number) return 'Informe o número.';
  if (!address.city) return 'Informe a cidade.';
  if (!address.district) return 'Informe o bairro.';
  if (address.state.length !== 2) return 'Informe o estado.';
  return '';
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function makeExternalRef() {
  return `netfiscal_mba_t5_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      service: 'create-pix',
      provider: 'blackcat',
      product: PRODUCT.name,
      amount: PRODUCT.amount,
      apiKeyConfigured: Boolean(String(process.env.BLACKCAT_API_KEY || '').trim())
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      success: false,
      message: 'Método não permitido.'
    });
  }

  try {
    const apiKey = String(process.env.BLACKCAT_API_KEY || '').trim();

    if (!apiKey) {
      console.error('BLACKCAT_API_KEY não configurada.');
      return res.status(500).json({
        success: false,
        message: 'Configuração de pagamento indisponível.'
      });
    }

    const body = parseBody(req);
    const student = normalizeStudent(body.student);
    const address = normalizeAddress(body.address);

    const studentError = validateStudent(student);
    if (studentError) {
      return res.status(400).json({ success: false, message: studentError });
    }

    const addressError = validateAddress(address);
    if (addressError) {
      return res.status(400).json({ success: false, message: addressError });
    }

    const externalRef = makeExternalRef();
    const documentType = student.taxId.length === 14 ? 'cnpj' : 'cpf';

    const payload = {
      amount: PRODUCT.amount,
      currency: PRODUCT.currency,
      paymentMethod: 'pix',
      items: [
        {
          title: PRODUCT.name,
          unitPrice: PRODUCT.amount,
          quantity: 1,
          tangible: false
        }
      ],
      customer: {
        name: student.name,
        email: student.email,
        phone: student.phone,
        document: {
          number: student.taxId,
          type: documentType
        }
      },
      pix: {
        expiresInDays: 1
      },
      metadata: PRODUCT.description,
      externalRef
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let providerResponse;

    try {
      providerResponse = await fetch(`${API_BASE}/sales/create-sale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await providerResponse.text();
    let data = {};

    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { message: raw || 'Resposta inválida do gateway.' };
    }

    if (!providerResponse.ok || data?.success === false) {
      console.error('Erro BlackCat:', providerResponse.status, data);

      return res.status(providerResponse.status >= 500 ? 502 : providerResponse.status).json({
        success: false,
        message: data?.message || data?.error || 'Não foi possível gerar o Pix.',
        gatewayStatus: providerResponse.status,
        details: data?.errors || data?.details || null
      });
    }

    const paymentData = data?.data?.paymentData || {};
    const pixCode = paymentData?.copyPaste || paymentData?.qrCode || null;
    const transactionId = data?.data?.transactionId || null;

    if (!pixCode) {
      console.error('Resposta BlackCat sem código Pix:', data);
      return res.status(502).json({
        success: false,
        message: 'A BlackCat não retornou o código Pix.'
      });
    }

    return res.status(200).json({
      success: true,
      paymentId: transactionId,
      externalRef,
      amount: PRODUCT.amount,
      pixCode,
      invoiceUrl: data?.data?.invoiceUrl || null,
      expiresAt: paymentData?.expiresAt || null
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({
        success: false,
        message: 'O serviço de pagamento demorou para responder. Tente novamente.'
      });
    }

    console.error('Erro interno ao criar Pix:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno ao gerar o Pix. Tente novamente.'
    });
  }
};

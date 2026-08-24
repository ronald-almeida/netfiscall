const API_BASE = 'https://api.gatewaypayshark.com.br';

const PRODUCT = Object.freeze({
  name: '#MBA - TURMA 4 (08/26)',
  description: 'MBA Reforma Tributária & Gestão Tributária - Turma 4 (08/26)',
  amount: 59940,
  currency: 'BRL',
  type: 'DIGITAL'
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
  return `netfiscal_mba_t4_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      service: 'create-pix',
      product: PRODUCT.name,
      amount: PRODUCT.amount,
      apiKeyConfigured: Boolean(String(process.env.PAYSHARK_API_KEY || '').trim())
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
    const apiKey = String(process.env.PAYSHARK_API_KEY || '').trim();

    if (!apiKey) {
      console.error('PAYSHARK_API_KEY não configurada.');
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

    const payload = {
      amount: PRODUCT.amount,
      currency: PRODUCT.currency,
      method: 'PIX',
      description: PRODUCT.description,
      externalRef,
      payer: {
        name: student.name,
        taxId: student.taxId,
        email: student.email,
        phone: student.phone
      },
      items: [
        {
          quantity: 1,
          name: PRODUCT.name,
          price: PRODUCT.amount,
          type: PRODUCT.type
        }
      ]
    };

    // O endereço é coletado no checkout, mas este produto é DIGITAL.
    // Não enviamos delivery/address à PayShark para evitar validações
    // desnecessárias como complement=null ou formatos de endereço.

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let providerResponse;

    try {
      providerResponse = await fetch(`${API_BASE}/v1/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
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

    if (!providerResponse.ok) {
      console.error('Erro PayShark:', providerResponse.status, data);

      return res.status(providerResponse.status >= 500 ? 502 : providerResponse.status).json({
        success: false,
        message: data?.message || data?.errorMessage || 'Não foi possível gerar o Pix.',
        gatewayStatus: providerResponse.status,
        details: data?.errors || data?.error || data?.details || null
      });
    }

    const pixCode = data?.data?.copypaste;

    if (!pixCode) {
      console.error('Resposta sem data.copypaste:', data);
      return res.status(502).json({
        success: false,
        message: 'O gateway não retornou o código Pix.'
      });
    }

    return res.status(200).json({
      success: true,
      paymentId: data?.id || null,
      externalRef,
      amount: PRODUCT.amount,
      pixCode
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

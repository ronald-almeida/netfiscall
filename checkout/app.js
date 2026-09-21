const form = document.getElementById('checkoutForm');
const steps = [...document.querySelectorAll('.step')];
const dots = [...document.querySelectorAll('.progress-dot')];

const goAddressBtn = document.getElementById('goAddressBtn');
const goPaymentBtn = document.getElementById('goPaymentBtn');
const generatePixBtn = document.getElementById('generatePixBtn');

const step1Message = document.getElementById('step1Message');
const step2Message = document.getElementById('step2Message');
const formMessage = document.getElementById('formMessage');

const modal = document.getElementById('pixModal');
const modalQr = document.getElementById('modalQr');
const pixCodeField = document.getElementById('pixCode');
const copyPixBtn = document.getElementById('copyPixBtn');

let currentStep = 1;
let currentPixCode = '';

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

function setStep(step) {
  currentStep = step;
  steps.forEach((el) => el.classList.toggle('active', Number(el.dataset.step) === step));
  dots.forEach((dot, index) => dot.classList.toggle('active', index < step));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function studentData() {
  return {
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim().toLowerCase(),
    phone: normalizePhone(document.getElementById('phone').value),
    taxId: digits(document.getElementById('taxId').value)
  };
}

function addressData() {
  return {
    zipCode: digits(document.getElementById('zipCode').value),
    street: document.getElementById('street').value.trim(),
    number: document.getElementById('number').value.trim(),
    city: document.getElementById('city').value.trim(),
    district: document.getElementById('district').value.trim(),
    complement: document.getElementById('complement').value.trim(),
    state: document.getElementById('state').value
  };
}

function validateStudent(showMessage = true) {
  const data = studentData();
  let message = '';

  if (data.name.length < 3 || !data.name.includes(' ')) message = 'Informe o nome completo do aluno.';
  else if (!validEmail(data.email)) message = 'Informe um e-mail válido.';
  else if (data.phone.length !== 10 && data.phone.length !== 11) message = 'Informe um telefone válido com DDD.';
  else if (data.taxId.length !== 11 && data.taxId.length !== 14) message = 'Informe um CPF/CNPJ válido.';

  if (showMessage) step1Message.textContent = message;
  goAddressBtn.classList.toggle('ready', !message);
  return !message;
}

function validateAddress(showMessage = true) {
  const data = addressData();
  let message = '';

  if (data.zipCode.length !== 8) message = 'Informe um CEP válido.';
  else if (!data.street) message = 'Informe o endereço.';
  else if (!data.number) message = 'Informe o número.';
  else if (!data.city) message = 'Informe a cidade.';
  else if (!data.district) message = 'Informe o bairro.';
  else if (!data.state) message = 'Selecione o estado.';

  if (showMessage) step2Message.textContent = message;
  goPaymentBtn.classList.toggle('ready', !message);
  return !message;
}

function formatGatewayDetails(details) {
  if (!details) return '';
  if (Array.isArray(details)) {
    return details.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.message || item.field || JSON.stringify(item);
      return String(item);
    }).filter(Boolean).join(' | ');
  }
  if (typeof details === 'object') {
    return Object.entries(details)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' | ');
  }
  return String(details);
}

function renderQr(pixCode) {
  modalQr.innerHTML = '';
  if (typeof QRCode !== 'function') {
    throw new Error('Não foi possível carregar o gerador de QR Code.');
  }

  new QRCode(modalQr, {
    text: pixCode,
    width: 230,
    height: 230,
    correctLevel: QRCode.CorrectLevel.M
  });
}

function openModal() {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

async function copyText(text, button) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }

  const old = button.textContent;
  button.textContent = 'Código Pix copiado!';
  setTimeout(() => { button.textContent = old; }, 1800);
}

goAddressBtn.addEventListener('click', () => {
  if (validateStudent(true)) setStep(2);
});

goPaymentBtn.addEventListener('click', () => {
  if (validateAddress(true)) setStep(3);
});

document.querySelectorAll('[data-back]').forEach((button) => {
  button.addEventListener('click', () => setStep(Number(button.dataset.back)));
});

['name', 'email', 'phone', 'taxId'].forEach((id) => {
  document.getElementById(id).addEventListener('input', () => validateStudent(false));
});

['zipCode', 'street', 'number', 'city', 'district', 'complement'].forEach((id) => {
  document.getElementById(id).addEventListener('input', () => validateAddress(false));
});
document.getElementById('state').addEventListener('change', () => validateAddress(false));

document.getElementById('phone').addEventListener('input', (event) => {
  event.target.value = digits(event.target.value).slice(0, 11);
});

document.getElementById('taxId').addEventListener('input', (event) => {
  event.target.value = digits(event.target.value).slice(0, 14);
});

document.getElementById('zipCode').addEventListener('input', (event) => {
  const value = digits(event.target.value).slice(0, 8);
  event.target.value = value.length > 5 ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.textContent = '';

  if (!validateStudent(false)) {
    setStep(1);
    validateStudent(true);
    return;
  }
  if (!validateAddress(false)) {
    setStep(2);
    validateAddress(true);
    return;
  }

  const oldText = generatePixBtn.textContent;
  generatePixBtn.disabled = true;
  generatePixBtn.textContent = 'Gerando Pix...';

  try {
    const response = await fetch('/api/create-pix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student: studentData(),
        address: addressData()
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.success) {
      const details = formatGatewayDetails(result.details);
      throw new Error([result.message || 'Não foi possível gerar o Pix.', details].filter(Boolean).join(' — '));
    }

    currentPixCode = result.pixCode;
    pixCodeField.value = currentPixCode;
    renderQr(currentPixCode);
    openModal();
  } catch (error) {
    console.error(error);
    formMessage.textContent = error.message || 'Erro ao gerar o Pix. Tente novamente.';
  } finally {
    generatePixBtn.disabled = false;
    generatePixBtn.textContent = oldText;
  }
});

copyPixBtn.addEventListener('click', () => copyText(currentPixCode, copyPixBtn));
document.querySelectorAll('[data-close-modal]').forEach((el) => el.addEventListener('click', closeModal));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
});

validateStudent(false);
validateAddress(false);


async function loadCheckoutInfoImage() {
  const image = document.getElementById('checkoutInfoImage');
  if (!image) return;
  try {
    const paths = [
      '/checkout/assets/mba-info.part1',
      '/checkout/assets/mba-info.part2',
      '/checkout/assets/mba-info.part3',
      '/checkout/assets/mba-info.part4'
    ];
    const parts = await Promise.all(paths.map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Falha ao carregar imagem informativa.');
      return response.text();
    }));
    image.src = 'data:image/webp;base64,' + parts.join('');
  } catch (error) {
    console.error(error);
  }
}

loadCheckoutInfoImage();

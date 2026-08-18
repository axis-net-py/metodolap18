const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  try {
    if (!process.env.DATABASE_URL) throw new Error('Database not configured');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) return res.status(400).json({ error: 'Formulario inválido.' });
    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const parts = parseMultipart(raw, boundary);
    const field = n => parts.find(p => p.name === n && !p.filename)?.value?.trim() || '';
    const file = parts.find(p => p.name === 'payment_proof' && p.filename);
    const required = ['first_name','last_name','company','role_title','phone','discovery_source','dietary_restriction'];
    if (required.some(n => !field(n)) || field('terms_accepted') !== 'true') return res.status(400).json({ error: 'Completa todos los campos obligatorios.' });
    if (file && file.data.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'El comprobante debe tener como máximo 6 MB.' });
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
    if (file && !allowed.includes(file.contentType)) return res.status(400).json({ error: 'Formato de comprobante no permitido.' });
    const sql = neon(process.env.DATABASE_URL);
    await sql`INSERT INTO lap18_registrations (first_name,last_name,company,role_title,phone,expectation,discovery_source,accessibility_required,accessibility_details,dietary_restriction,payment_currency,payment_amount,payment_proof_name,payment_proof_mime,payment_proof,terms_accepted,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referrer,user_agent) VALUES (${field('first_name')},${field('last_name')},${field('company')},${field('role_title')},${field('phone')},${field('expectation')||null},${field('discovery_source')},${Boolean(field('accessibility_details'))},${field('accessibility_details')||null},${field('dietary_restriction')},${'PYG'},${2300000},${file?.filename||null},${file?.contentType||null},${file?.data||null},${true},${field('utm_source')||null},${field('utm_medium')||null},${field('utm_campaign')||null},${field('utm_content')||null},${field('utm_term')||null},${field('referrer')||null},${req.headers['user-agent']||null})`;
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('registration_error', err);
    return res.status(500).json({ error: 'No fue posible registrar tu inscripción. Intenta nuevamente.' });
  }
}

function parseMultipart(buffer, boundary) {
  const marker = Buffer.from('--' + boundary);
  const parts = [];
  let pos = buffer.indexOf(marker);
  while (pos !== -1) {
    const next = buffer.indexOf(marker, pos + marker.length);
    if (next === -1) break;
    let chunk = buffer.subarray(pos + marker.length, next);
    if (chunk.subarray(0,2).toString() === '\r\n') chunk = chunk.subarray(2);
    if (chunk.length >= 2 && chunk.subarray(chunk.length-2).toString() === '\r\n') chunk = chunk.subarray(0,chunk.length-2);
    const sep = chunk.indexOf(Buffer.from('\r\n\r\n'));
    if (sep > -1) {
      const headers = chunk.subarray(0,sep).toString('utf8');
      const data = chunk.subarray(sep+4);
      const name = headers.match(/name="([^"]+)"/i)?.[1];
      const filename = headers.match(/filename="([^"]*)"/i)?.[1];
      const contentType = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim();
      if (name) parts.push(filename ? {name,filename,contentType:contentType||'application/octet-stream',data} : {name,value:data.toString('utf8')});
    }
    pos = next;
  }
  return parts;
}
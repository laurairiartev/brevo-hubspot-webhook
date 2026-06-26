/**
 * Endpoint receptor: Brevo Email Opens → HubSpot
 *
 * Recibe el webhook de Brevo cuando un contacto abre un email,
 * busca el contacto en HubSpot por email, y actualiza la propiedad
 * `brevo_apertura_email` con la fecha/hora del evento.
 *
 * HubSpot Workflow luego detecta ese cambio y envía el WhatsApp.
 */

const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const BREVO_WEBHOOK_SECRET = process.env.BREVO_WEBHOOK_SECRET; // opcional pero recomendado

export default async function handler(req, res) {
  // Solo aceptar POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Brevo puede enviar un array de eventos o un objeto solo
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      const { event: eventType, email, ts_epoch } = event;

      // Solo procesar aperturas
      if (eventType !== "opened") continue;

      if (!email) {
        console.warn("Evento sin email, ignorando:", event);
        continue;
      }

      console.log(`Apertura detectada: ${email}`);

      // 1. Buscar contacto en HubSpot por email
      const searchRes = await fetch(
        "https://api.hubapi.com/crm/v3/objects/contacts/search",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HUBSPOT_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "email",
                    operator: "EQ",
                    value: email,
                  },
                ],
              },
            ],
            properties: ["email", "hs_object_id"],
            limit: 1,
          }),
        }
      );

      const searchData = await searchRes.json();

      if (!searchData.results || searchData.results.length === 0) {
        console.warn(`Contacto no encontrado en HubSpot: ${email}`);
        continue;
      }

      const contactId = searchData.results[0].id;

      // 2. Actualizar propiedad brevo_apertura_email con timestamp del evento
      // El valor debe ser timestamp en milisegundos (epoch ms) para propiedades tipo datetime
      const apertura_timestamp = ts_epoch || Date.now();

      const updateRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${HUBSPOT_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: {
              brevo_apertura_email: apertura_timestamp,
            },
          }),
        }
      );

      if (!updateRes.ok) {
        const errData = await updateRes.json();
        console.error(`Error actualizando contacto ${contactId}:`, errData);
        continue;
      }

      console.log(
        `✓ HubSpot actualizado: contacto ${contactId} (${email}) | timestamp: ${apertura_timestamp}`
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error inesperado:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

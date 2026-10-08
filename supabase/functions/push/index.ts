// Bountiful phone notifications (Web Push).
// - GET  -> { publicKey }   (the app needs it to subscribe a phone; the key pair is created on first use)
// - POST -> { secret, users, key, params, url, tag }: sends a notification to every device of those users.
//   Only the database can call it (it knows the secret stored in the push_config table).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Texts in the six languages of the app (same wording as the in-app notifications)
const TEXT: Record<string, Record<string, string>> = {"mention":{"en":"{name} mentioned you","de":"{name} hat dich erwähnt","es":"{name} te ha mencionado","pt":"{name} mencionou você","nl":"{name} heeft je genoemd","sv":"{name} nämnde dig"},"assigned":{"en":"A new task for you","de":"Neue Aufgabe für dich","es":"Una tarea nueva para ti","pt":"Uma nova tarefa para você","nl":"Een nieuwe taak voor jou","sv":"En ny uppgift åt dig"},"changed":{"en":"A task of yours changed","de":"Eine deiner Aufgaben wurde geändert","es":"Una de tus tareas ha cambiado","pt":"Uma das suas tarefas mudou","nl":"Een van je taken is gewijzigd","sv":"En av dina uppgifter ändrades"},"done":{"en":"{name} finished a task","de":"{name} hat eine Aufgabe erledigt","es":"{name} terminó una tarea","pt":"{name} terminou uma tarefa","nl":"{name} heeft een taak afgerond","sv":"{name} blev klar med en uppgift"},"started":{"en":"{name} started a task","de":"{name} hat eine Aufgabe begonnen","es":"{name} empezó una tarea","pt":"{name} começou uma tarefa","nl":"{name} is aan een taak begonnen","sv":"{name} började på en uppgift"},"delay":{"en":"{name} explained a delay","de":"{name} hat eine Verspätung erklärt","es":"{name} explicó un retraso","pt":"{name} explicou um atraso","nl":"{name} heeft een vertraging toegelicht","sv":"{name} förklarade en försening"},"comment":{"en":"{name} left a comment","de":"{name} hat einen Kommentar hinterlassen","es":"{name} dejó un comentario","pt":"{name} deixou um comentário","nl":"{name} liet een opmerking achter","sv":"{name} lämnade en kommentar"},"joined":{"en":"A new person joined the team","de":"Neue Person im Team","es":"Una persona nueva se unió al equipo","pt":"Uma nova pessoa entrou na equipe","nl":"Er is iemand nieuw in het team","sv":"En ny person har gått med i teamet"},"rooms":{"en":"{name} listed rooms to clean","de":"{name} hat Zimmer zur Reinigung eingetragen","es":"{name} anotó habitaciones por limpiar","pt":"{name} listou quartos para limpar","nl":"{name} heeft kamers voor schoonmaak genoteerd","sv":"{name} listade rum att städa"},"roomAssigned":{"en":"Rooms for you to clean","de":"Zimmer für dich zu reinigen","es":"Habitaciones para limpiar","pt":"Quartos para você limpar","nl":"Kamers om schoon te maken","sv":"Rum att städa åt dig"},"roomDone":{"en":"{name} finished a room","de":"{name} hat ein Zimmer fertig gereinigt","es":"{name} terminó una habitación","pt":"{name} terminou um quarto","nl":"{name} heeft een kamer afgerond","sv":"{name} blev klar med ett rum"},"report.day":{"en":"{name}’s daily report is ready","de":"Tagesbericht von {name} ist da","es":"El informe diario de {name} está listo","pt":"O relatório diário de {name} está pronto","nl":"Dagrapport van {name} is klaar","sv":"{name}s dagsrapport är klar"},"report.week":{"en":"{name}’s weekly report is ready","de":"Wochenbericht von {name} ist da","es":"El informe semanal de {name} está listo","pt":"O relatório semanal de {name} está pronto","nl":"Weekrapport van {name} is klaar","sv":"{name}s veckorapport är klar"},"report.month":{"en":"{name}’s monthly report is ready","de":"Monatsbericht von {name} ist da","es":"El informe mensual de {name} está listo","pt":"O relatório mensal de {name} está pronto","nl":"Maandrapport van {name} is klaar","sv":"{name}s månadsrapport är klar"},"report.quarter":{"en":"{name}’s quarterly report is ready","de":"Quartalsbericht von {name} ist da","es":"El informe trimestral de {name} está listo","pt":"O relatório trimestral de {name} está pronto","nl":"Kwartaalrapport van {name} is klaar","sv":"{name}s kvartalsrapport är klar"},"invite":{"en":"{name} invited you to take over a task","de":"{name} hat dich eingeladen, eine Aufgabe zu übernehmen","es":"{name} te invitó a asumir una tarea","pt":"{name} convidou você para assumir uma tarefa","nl":"{name} nodigde je uit om een taak over te nemen","sv":"{name} bjöd in dig att ta över en uppgift"},"invite.accepted":{"en":"{name} accepted your task invitation","de":"{name} hat deine Einladung angenommen","es":"{name} aceptó tu invitación a una tarea","pt":"{name} aceitou o seu convite para uma tarefa","nl":"{name} heeft je uitnodiging voor een taak geaccepteerd","sv":"{name} tackade ja till din inbjudan"},"invite.declined":{"en":"{name} declined your task invitation","de":"{name} hat deine Einladung abgelehnt","es":"{name} rechazó tu invitación a una tarea","pt":"{name} recusou o seu convite para uma tarefa","nl":"{name} heeft je uitnodiging voor een taak afgewezen","sv":"{name} tackade nej till din inbjudan"},"meetingNew":{"en":"{name} asks for a meeting","de":"{name} bittet um eine Besprechung","es":"{name} pide una reunión","pt":"{name} pede uma reunião","nl":"{name} vraagt om een gesprek","sv":"{name} ber om ett möte"},"meeting.accepted":{"en":"{name} accepted your meeting","de":"{name} hat deine Besprechung angenommen","es":"{name} aceptó tu reunión","pt":"{name} aceitou a sua reunião","nl":"{name} heeft je gesprek geaccepteerd","sv":"{name} accepterade ditt möte"},"meeting.declined":{"en":"{name} declined your meeting","de":"{name} hat deine Besprechung abgelehnt","es":"{name} rechazó tu reunión","pt":"{name} recusou a sua reunião","nl":"{name} heeft je gesprek geweigerd","sv":"{name} avböjde ditt möte"},"roomsEdited":{"en":"{name} changed a room request","de":"{name} hat eine Zimmeranfrage geändert","es":"{name} cambió una solicitud de habitación","pt":"{name} alterou um pedido de quarto","nl":"{name} heeft een kamerverzoek gewijzigd","sv":"{name} ändrade en rumsförfrågan"},"roomEdited":{"en":"A room of yours was changed","de":"Eines deiner Zimmer wurde geändert","es":"Se cambió una de tus habitaciones","pt":"Um dos seus quartos foi alterado","nl":"Een van je kamers is gewijzigd","sv":"Ett av dina rum ändrades"}};

async function config() {
  const { data } = await admin.from("push_config").select("*").eq("id", 1).single();
  if (data && data.public_key && data.private_key) return data;
  const k = webpush.generateVAPIDKeys();
  await admin.from("push_config").update({ public_key: k.publicKey, private_key: k.privateKey }).eq("id", 1).is("public_key", null);
  return (await admin.from("push_config").select("*").eq("id", 1).single()).data;
}

const fill = (s: string, p: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const cfg = await config();
    if (req.method === "GET") return json({ publicKey: cfg.public_key });
    const b = await req.json();
    if (!b || b.secret !== cfg.secret) return json({ error: "no" }, 403);
    const users: string[] = Array.isArray(b.users) ? b.users : [];
    if (!users.length) return json({ sent: 0 });
    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", users);
    webpush.setVapidDetails("https://limisan98.github.io/bountiful/", cfg.public_key, cfg.private_key);
    const params = b.params || {};
    let sent = 0;
    await Promise.all((subs || []).map(async (s) => {
      const lang = TEXT[b.key] && TEXT[b.key][s.lang] ? s.lang : "en";
      // "dm" and "chat" use the sender's name as the title; everything else is a translated sentence
      const title = TEXT[b.key] ? fill(TEXT[b.key][lang], params) : (params.title || "Bountiful");
      const payload = JSON.stringify({ title, body: params.body || "", url: b.url || "./", tag: b.tag || undefined });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }));
    return json({ sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

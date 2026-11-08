// =====================================================================
// Evaluación 2 - ContentFlow - Punto 4: Desarrollo de consultas (IE4, IE5, IE6)

// =====================================================================
// 4.1 Consultas de lectura IE4
// =====================================================================

// 1. Varias condiciones (AND): segmentar usuarios de móvil y género femenino para personalizar la experiencia.
printjson(db.usuarios.find({ dispositivo: "Móvil", genero: "Femenino" }).toArray());


// 2. Campo anidado: identificar campañas con metas altas de likes.
printjson(db.campanas.find({ "metricas_objetivo.likes": { $gte: 500 } }).toArray());

// 3. Condición OR: diseño de contenido, publicaciones en video o de la categoría Deportes.
printjson(db.publicaciones.countDocuments({ $or: [{ tipo: "Video" }, { categoria: "Deportes" }] }));

// 4. Proyección: lista de contacto (solo nombre y correo) de los usuarios de un país.
printjson(db.usuarios.find({ pais: "Kenya" }, { _id: 0, nombre: 1, correo: 1 }).toArray());


// 5. Ordenamiento y límite: los 10 comentarios con más likes (contenido que más gusta).
printjson(db.comentarios.find({}, { comentario: 1, likes: 1, publicacion_id: 1 }).sort({ likes: -1 }).limit(10).toArray());

// 6. Búsqueda compuesta:publicaciones de Tecnología en marzo de 2025, de la más reciente a la más antigua.
printjson(db.publicaciones.find(
  { categoria: "Tecnología", fecha_publicacion: { $gte: new Date("2025-03-01"), $lt: new Date("2025-04-01") } },
  { contenido: 1, categoria: 1, fecha_publicacion: 1 }
).sort({ fecha_publicacion: -1 }).toArray());


// =====================================================================
// 4.2 Pipelines de agregación (IE5)
// =====================================================================

// 1. Usuarios más activos: identificar a los 5 usuarios con más publicaciones para estrategias de retención.
printjson(db.publicaciones.aggregate([
  { $group: { _id: "$usuario_id", total_publicaciones: { $sum: 1 } } },
  { $sort: { total_publicaciones: -1, _id: 1 } },
  { $limit: 5 },
  { $lookup: { from: "usuarios", localField: "_id", foreignField: "_id", as: "usuario" } },
  { $unwind: "$usuario" },
  { $project: { _id: 0, usuario_id: "$_id", nombre: "$usuario.nombre", pais: "$usuario.pais", total_publicaciones: 1 } }
]).toArray());

// 2. Contenidos más populares: las 5 publicaciones con más reacciones.
printjson(db.reacciones.aggregate([
  { $group: { _id: "$publicacion_id", total_reacciones: { $sum: 1 } } },
  { $sort: { total_reacciones: -1, _id: 1 } },
  { $limit: 5 },
  { $lookup: { from: "publicaciones", localField: "_id", foreignField: "_id", as: "pub" } },
  { $unwind: "$pub" },
  { $project: { _id: 0, publicacion_id: "$_id", categoria: "$pub.categoria", tipo: "$pub.tipo", total_reacciones: 1 } }
]).toArray());

// 3. Mejores horarios de publicación: definir en qué horas publicar. Hora en UTC; para hora de Chile se usa timezone.
printjson(db.publicaciones.aggregate([
  { $group: { _id: { $hour: { date: "$fecha_publicacion", timezone: "America/Santiago" } }, publicaciones: { $sum: 1 } } },
  { $sort: { publicaciones: -1 } },
  { $limit: 5 }
]).toArray());

// 4. Éxito de campañas: medir las reacciones obtenidas frente a la meta de likes de cada campaña.
printjson(db.campanas.aggregate([
  { $unwind: "$publicaciones_asociadas" },
  { $lookup: { from: "reacciones", localField: "publicaciones_asociadas", foreignField: "publicacion_id", as: "reacciones" } },
  { $group: { _id: "$_id", nombre: { $first: "$nombre" }, objetivo: { $first: "$objetivo" }, meta_likes: { $first: "$metricas_objetivo.likes" }, reacciones_obtenidas: { $sum: { $size: "$reacciones" } } } },
  { $addFields: { cumplimiento_pct: { $cond: [{ $gt: ["$meta_likes", 0] }, { $round: [{ $multiply: [{ $divide: ["$reacciones_obtenidas", "$meta_likes"] }, 100] }, 1] }, null] } } },
  { $sort: { cumplimiento_pct: -1 } },
  { $limit: 10 }
]).toArray());

// 5. Publicaciones con más "Me gusta": contenido favorito de la audiencia.
printjson(db.reacciones.aggregate([
  { $match: { tipo_reaccion: "Me gusta" } },
  { $group: { _id: "$publicacion_id", total_me_gusta: { $sum: 1 } } },
  { $sort: { total_me_gusta: -1, _id: 1 } },
  { $limit: 5 }
]).toArray());

// =====================================================================
// 4.3 Eficiencia CON explain IE6
// =====================================================================
function resumen(etiqueta, explicacion) {
  var etapas = [];
  var plan = explicacion.queryPlanner.winningPlan;
  plan = plan.queryPlan || plan;
  while (plan) {
    etapas.push(plan.stage);
    plan = plan.inputStage || (plan.inputStages && plan.inputStages[0]);
  }
  var s = explicacion.executionStats;
  printjson({
    prueba: etiqueta,
    plan: etapas.join(" > "),
    tiempo_ms: s.executionTimeMillis,
    docs_examinados: s.totalDocsExamined,
    claves_examinadas: s.totalKeysExamined,
    docs_retornados: s.nReturned
  });
}

// Publicaciones de un usuario ordenadas por fecha
try { db.publicaciones.dropIndex({ usuario_id: 1, fecha_publicacion: -1 }); } catch (e) { print("(sin índice previo)"); }
var q1 = function () { return db.publicaciones.find({ usuario_id: "user_94" }).sort({ fecha_publicacion: -1 }); };
resumen("C01 ANTES", q1().explain("executionStats"));


db.publicaciones.createIndex({ usuario_id: 1, fecha_publicacion: -1 });
resumen("C01 DESPUÉS", q1().explain("executionStats"));

// Reacciones de una publicación (base del ranking de popularidad)
try { db.reacciones.dropIndex({ publicacion_id: 1, tipo_reaccion: 1 }); } catch (e) { print("(sin índice previo)"); }
var q2 = function () { return db.reacciones.find({ publicacion_id: "pub_430" }); };
resumen("C02 ANTES", q2().explain("executionStats"));


db.reacciones.createIndex({ publicacion_id: 1, tipo_reaccion: 1 });
resumen("C02 DESPUÉS", q2().explain("executionStats"));

// Mejora propuesta: consulta cubierta (el índice contiene todos los campos pedidos)
resumen("C03 CUBIERTA",
  db.reacciones.find({ publicacion_id: "pub_430" }, { _id: 0, publicacion_id: 1, tipo_reaccion: 1 }).explain("executionStats"));

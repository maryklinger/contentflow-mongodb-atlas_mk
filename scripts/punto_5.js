// =====================================================================
// Evaluación 2 - ContentFlow - Punto 5: Operaciones CRUD y calidad de datos (IE7, IE8)


// =====================================================================
db = db.getSiblingDB("ContentFlow_Solution_MK");
const W = { writeConcern: { w: "majority" } };

function conteos(etiqueta) {
  print("--- " + etiqueta);
  printjson({
    usuarios: db.usuarios.countDocuments(), publicaciones: db.publicaciones.countDocuments(),
    reacciones: db.reacciones.countDocuments(), comentarios: db.comentarios.countDocuments(),
    campanas: db.campanas.countDocuments()
  });
}

// Precondición: los documentos de prueba no deben existir de antes.
if (db.usuarios.findOne({ _id: "new_user_501" }) || db.publicaciones.findOne({ _id: "pub_501" })) {
  throw new Error("Ya existen documentos de prueba (new_user_501 / pub_501). Elimínalos antes de ejecutar.");
}
conteos("ESTADO INICIAL");

// =====================================================================
// CASO 1. Un usuario nuevo se registra y publica (insertar + leer)
// =====================================================================
//antes

print("=== CASO 1: registro de nuevo usuario y primera publicación");
printjson(db.usuarios.find({ _id: "new_user_501" }).toArray());           
printjson(db.usuarios.insertOne(
  { _id: "new_user_501", nombre: "Robert Downey Jr", correo: "robert.downey@example.com", pais: "Chile",
    genero: "Femenino", fecha_registro: new Date(), dispositivo: "Móvil" }, W));
printjson(db.usuarios.find({ _id: "new_user_501" }).toArray());           

// después
print("publicaciones del usuario (antes): " + db.publicaciones.countDocuments({ usuario_id: "new_user_501" }));
printjson(db.publicaciones.insertOne(
  { _id: "pub_501", usuario_id: "new_user_501", contenido: "Mi primera publicación en ContentFlow",
    fecha_publicacion: new Date(), categoria: "Tecnología", hashtags: ["#innovacion", "#aprendizaje"], tipo: "Texto" }, W));


// Lectura con $lookup: confirma que la referencia al autor es válida
printjson(db.publicaciones.aggregate([
  { $match: { _id: "pub_501" } },
  { $lookup: { from: "usuarios", localField: "usuario_id", foreignField: "_id", as: "autor" } },
  { $unwind: "$autor" },
  { $project: { contenido: 1, categoria: 1, hashtags: 1, autor: "$autor.nombre", pais: "$autor.pais" } }
]).toArray());


// =====================================================================
// CASO 2. La audiencia interactúa con la publicación
// =====================================================================


print("=== CASO 2: interacciones sobre el documento pub_501");
print("reacciones/comentarios -- antes: " + db.reacciones.countDocuments({ publicacion_id: "pub_501" }) +
      " / " + db.comentarios.countDocuments({ publicacion_id: "pub_501" }));
printjson(db.reacciones.insertOne(
  { _id: "react_501", usuario_id: "user_94", publicacion_id: "pub_501", tipo_reaccion: "Me gusta", fecha: new Date() }, W));
printjson(db.comentarios.insertOne(
  { _id: "comm_501", usuario_id: "user_92", publicacion_id: "pub_501",
    comentario: "Excelente publicación, bienvenida a ContentFlow", fecha: new Date(), likes: 0 }, W));
print("reacciones/comentarios (después): " + db.reacciones.countDocuments({ publicacion_id: "pub_501" }) +
      " / " + db.comentarios.countDocuments({ publicacion_id: "pub_501" }));

// Se usa el comando $inc: otros usuarios dan like al comentario
printjson(db.comentarios.find({ _id: "comm_501" }, { comentario: 1, likes: 1 }).toArray());
printjson(db.comentarios.updateOne({ _id: "comm_501" }, { $inc: { likes: 3 } }));
printjson(db.comentarios.find({ _id: "comm_501" }, { comentario: 1, likes: 1 }).toArray());

// Se usa el comando $push: la autora agrega un hashtag
printjson(db.publicaciones.find({ _id: "pub_501" }, { hashtags: 1 }).toArray());
printjson(db.publicaciones.updateOne({ _id: "pub_501" }, { $push: { hashtags: "#cultura" } }));
printjson(db.publicaciones.find({ _id: "pub_501" }, { hashtags: 1 }).toArray());

// Se usa el comando $set: el usuario cambia su reacción
printjson(db.reacciones.find({ _id: "react_501" }).toArray());
printjson(db.reacciones.updateOne({ _id: "react_501" }, { $set: { tipo_reaccion: "Me encanta" } }));
printjson(db.reacciones.find({ _id: "react_501" }).toArray());

// =====================================================================
// CASO 3. La publicación se suma a una campaña 
// Se usa el comando $addToSet, el cual evita publicaciones repetidas dentro de una campaña.
// =====================================================================
print("=== CASO 3: publicación asociada a camp_1");
printjson(db.campanas.find({ _id: "camp_1" }, { nombre: 1, publicaciones_asociadas: 1, metricas_objetivo: 1 }).toArray());
printjson(db.campanas.updateOne({ _id: "camp_1" },
  { $addToSet: { publicaciones_asociadas: "pub_501" }, $inc: { "metricas_objetivo.likes": 50 } }));
printjson(db.campanas.find({ _id: "camp_1" }, { nombre: 1, publicaciones_asociadas: 1, metricas_objetivo: 1 }).toArray());
// Validación de referencias: asociadas == encontradas
printjson(db.campanas.aggregate([
  { $match: { _id: "camp_1" } },
  { $lookup: { from: "publicaciones", localField: "publicaciones_asociadas", foreignField: "_id", as: "pubs" } },
  { $project: { nombre: 1, asociadas: { $size: "$publicaciones_asociadas" }, encontradas: { $size: "$pubs" } } }
]).toArray());
// Repetir la operación no duplica (modifiedCount esperado: 0)
printjson(db.campanas.updateOne({ _id: "camp_1" }, { $addToSet: { publicaciones_asociadas: "pub_501" } }));

// =====================================================================
// CASO 4. El usuario se da de baja (eliminación en cascada manual)
// Criterio: se elimina en orden inverso a las dependencias para no dejar
// referencias huérfanas: interacciones -> campaña -> publicación -> usuario.
// =====================================================================
print("=== CASO 4: se elimina al usuario nuevo");
printjson({
  pubs_del_usuario: db.publicaciones.countDocuments({ usuario_id: "new_user_501" }),
  reacciones_del_usuario: db.reacciones.countDocuments({ usuario_id: "new_user_501" }),
  comentarios_del_usuario: db.comentarios.countDocuments({ usuario_id: "new_user_501" }),
  reacciones_en_su_pub: db.reacciones.countDocuments({ publicacion_id: "pub_501" }),
  comentarios_en_su_pub: db.comentarios.countDocuments({ publicacion_id: "pub_501" }),
  campanas_que_la_incluyen: db.campanas.countDocuments({ publicaciones_asociadas: "pub_501" })
});
printjson(db.reacciones.deleteMany({ publicacion_id: "pub_501" }, W));
printjson(db.comentarios.deleteMany({ publicacion_id: "pub_501" }, W));
printjson(db.campanas.updateOne({ _id: "camp_1" },
  { $pull: { publicaciones_asociadas: "pub_501" }, $inc: { "metricas_objetivo.likes": -50 } }));
printjson(db.publicaciones.deleteOne({ _id: "pub_501" }, W));
printjson(db.usuarios.deleteOne({ _id: "new_user_501" }, W));

conteos("DESPUÉS DE LA ELIMINACIÓN (Se espera que el conteo sea igual a 500 en todas, salvo reacciones si ya se corrigió el duplicado)");
printjson(db.campanas.find({ _id: "camp_1" }, { publicaciones_asociadas: 1, metricas_objetivo: 1 }).toArray());

// =====================================================================
// CALIDAD DE DATOS (IE8)
// =====================================================================
print("=== CALIDAD 1: duplicados de reacciones (un usuario, una reacción por publicación)");
const grupos = db.reacciones.aggregate([
  { $group: { _id: { usuario_id: "$usuario_id", publicacion_id: "$publicacion_id" }, veces: { $sum: 1 }, ids: { $push: "$_id" } } },
  { $match: { veces: { $gt: 1 } } }
]).toArray();
printjson(grupos);
// Criterio: se conserva la reacción más reciente y se archiva la eliminada en auditoria_calidad.
grupos.forEach(function (g) {
  const docs = db.reacciones.find({ _id: { $in: g.ids } }).sort({ fecha: -1 }).toArray();
  docs.slice(1).forEach(function (d) {
    db.auditoria_calidad.insertOne({
      coleccion: "reacciones", motivo: "Reaccion duplicada: mismo usuario y misma publicacion",
      accion: "eliminada", fecha_correccion: new Date(), documento_original: d });
    printjson(db.reacciones.deleteOne({ _id: d._id }, W));
  });
});
// Prevención: la base rechaza nuevos duplicados (error E11000 -> HTTP 409 en la API)
db.reacciones.createIndex({ usuario_id: 1, publicacion_id: 1 }, { unique: true });
printjson(db.auditoria_calidad.find().toArray());

print("=== CALIDAD 2: referencias inválidas (esperado: 0 en todas)");
function invalidas(col, campo, destino, nombre) {
  const r = db[col].aggregate([
    { $lookup: { from: destino, localField: campo, foreignField: "_id", as: "x" } },
    { $group: { _id: null, revisadas: { $sum: 1 }, invalidas: { $sum: { $cond: [{ $eq: [{ $size: "$x" }, 0] }, 1, 0] } } } }
  ]).toArray();
  print(nombre + ": " + JSON.stringify(r));
}
invalidas("publicaciones", "usuario_id", "usuarios", "publicaciones -> usuarios");
invalidas("reacciones", "usuario_id", "usuarios", "reacciones -> usuarios");
invalidas("reacciones", "publicacion_id", "publicaciones", "reacciones -> publicaciones");
invalidas("comentarios", "usuario_id", "usuarios", "comentarios -> usuarios");
invalidas("comentarios", "publicacion_id", "publicaciones", "comentarios -> publicaciones");
printjson(db.campanas.aggregate([
  { $unwind: "$publicaciones_asociadas" },
  { $lookup: { from: "publicaciones", localField: "publicaciones_asociadas", foreignField: "_id", as: "p" } },
  { $group: { _id: null, referencias: { $sum: 1 }, invalidas: { $sum: { $cond: [{ $eq: [{ $size: "$p" }, 0] }, 1, 0] } } } }
]).toArray());

print("=== CALIDAD 3: inconsistencias de fechas (solo se documentan, no se modifican)");
printjson(db.publicaciones.aggregate([
  { $lookup: { from: "usuarios", localField: "usuario_id", foreignField: "_id", as: "u" } }, { $unwind: "$u" },
  { $group: { _id: null, revisadas: { $sum: 1 }, inconsistentes: { $sum: { $cond: [{ $lt: ["$fecha_publicacion", "$u.fecha_registro"] }, 1, 0] } } } }
]).toArray());
printjson(db.reacciones.aggregate([
  { $lookup: { from: "publicaciones", localField: "publicacion_id", foreignField: "_id", as: "p" } }, { $unwind: "$p" },
  { $group: { _id: null, revisadas: { $sum: 1 }, inconsistentes: { $sum: { $cond: [{ $lt: ["$fecha", "$p.fecha_publicacion"] }, 1, 0] } } } }
]).toArray());
printjson(db.comentarios.aggregate([
  { $lookup: { from: "publicaciones", localField: "publicacion_id", foreignField: "_id", as: "p" } }, { $unwind: "$p" },
  { $group: { _id: null, revisadas: { $sum: 1 }, inconsistentes: { $sum: { $cond: [{ $lt: ["$fecha", "$p.fecha_publicacion"] }, 1, 0] } } } }
]).toArray());
print("campañas con fecha_fin < fecha_inicio: " + db.campanas.countDocuments({ $expr: { $lt: ["$fecha_fin", "$fecha_inicio"] } }));
conteos("ESTADO FINAL");

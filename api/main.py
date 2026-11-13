"""
API REST de ContentFlow, desarrollada con FastAPI y pymongo, la cual se conecta a la base de datos
creada en MongoDB Atlas. Por un lado, permite leer y escribir información de las colecciones de
usuarios, publicaciones y reacciones. Por otro lado, incorpora validaciones, control de errores y
registros de actividad, esto con el fin de mantener la trazabilidad de las operaciones.

Para poder ejecutarla, se debe utilizar el siguiente comando desde la raíz del proyecto:
    python -m uvicorn api.main:app --reload
La documentación interactiva queda disponible en http://127.0.0.1:8000/docs

El string de conexión no se escribe en el código. Se lee desde variables de entorno llamadas
MONGODB_URI y DB_NAME, las cuales se guardan en el archivo .env, excluido del repositorio de Git.
"""

import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, DuplicateKeyError, PyMongoError

# A continuación, se cargan las variables de entorno definidas en el archivo .env
load_dotenv()


# ------- Registro de actividad (logs) ------
# Se configura un registro que guarda cada evento tanto en la consola como en el archivo
# logs/api.log, esto con el fin de poder revisar después qué operaciones se realizaron y si
# ocurrió algún error.

os.makedirs("logs", exist_ok=True)
logger = logging.getLogger("contentflow")
logger.setLevel(logging.INFO)
for h in (logging.StreamHandler(),
          RotatingFileHandler("logs/api.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")):
    h.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
    logger.addHandler(h)


# ------- Conexión con la BD MongoDB Atlas ------
# Se crea un único cliente de MongoDB, el cual se reutiliza en todas las solicitudes, para no
# abrir una conexión nueva por cada petición y así respetar el límite de conexiones del tier M0.
# Además, se utiliza el write concern "majority", tal como se documentó en la sección 2.6.
_client = None


def get_db():
    global _client
    if _client is None:
        uri = os.getenv("MONGODB_URI")
        # Con el if controlamos que, si la variable de entorno no existe, la API se detiene
        # con un mensaje claro y descriptivo.
        if not uri:
            raise RuntimeError("No se encuentra la variable de entorno MONGODB_URI, por favor revisa tu archivo .env")
        _client = MongoClient(uri, serverSelectionTimeoutMS=5000, w="majority")
    return _client[os.getenv("DB_NAME", "ContentFlow_Solution_MK")]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Al momento de iniciar la API, se verifica la conexión con Atlas y se asegura el índice único de
    # reacciones, esto con el fin de evitar que un usuario pueda reaccionar dos veces a la misma publicación.
    db = get_db()
    try:
        db.command("ping")
        db.reacciones.create_index([("usuario_id", 1), ("publicacion_id", 1)], unique=True)
        logger.info("Conexión con MongoDB Atlas verificada (base: %s)", db.name)
    except PyMongoError as e:
        logger.error("No se pudo verificar la conexión al iniciar: %s", type(e).__name__)
    yield


app = FastAPI(title="ContentFlow API", version="1.0", lifespan=lifespan)


@app.middleware("http")
async def registrar_solicitudes(request: Request, call_next):
    # Cada vez que la API recibe una solicitud, se deja registrado en el log qué método se utilizó
    # (GET, POST, etc.), a qué ruta se llamó, qué código de respuesta se entregó y cuánto tiempo
    # demoró. Esto con el fin de tener trazabilidad de todo lo que le llega a la API.
    inicio = time.perf_counter()
    response = await call_next(request)
    logger.info("%s %s -> %s (%.0f ms)", request.method, request.url.path,
                response.status_code, (time.perf_counter() - inicio) * 1000)
    return response


# ------- Control de errores ------
# A continuación, se define la respuesta para cada tipo de error, y cada una lleva un código HTTP
# distinto: 
# - 400 cuando los datos enviados no son válidos.
# - 409 cuando el registro ya existe.
# - 503 cuando no hay conexión con la base de datos.
# - 500 cuando ocurre un error interno.
# Esto con el fin de que quien utilice la API entienda qué fue lo que falló.
@app.exception_handler(RequestValidationError)
async def error_validacion(request: Request, exc: RequestValidationError):
    errores = [{"campo": ".".join(str(p) for p in e["loc"][1:]) or str(e["loc"][0]), "mensaje": e["msg"]}
               for e in exc.errors()]
    logger.warning("Entrada inválida en %s %s: %s", request.method, request.url.path, errores)
    return JSONResponse(status_code=400, content={"detail": "Entrada inválida", "errores": errores})


@app.exception_handler(DuplicateKeyError)
async def error_duplicado(request: Request, exc: DuplicateKeyError):
    logger.warning("Clave duplicada en %s %s", request.method, request.url.path)
    return JSONResponse(status_code=409, content={"detail": "El registro ya existe (clave duplicada)."})


@app.exception_handler(ConnectionFailure)
async def error_conexion(request: Request, exc: ConnectionFailure):
    logger.error("Sin conexión con MongoDB en %s %s", request.method, request.url.path)
    return JSONResponse(status_code=503, content={"detail": "No hay conexión con la base de datos."})


@app.exception_handler(Exception)
async def error_interno(request: Request, exc: Exception):
    # Si ocurre un error que no estaba previsto, el detalle completo queda guardado en el log,
    # pero al usuario solo se le responde un mensaje general. Esto con el fin de no mostrar
    # información interna de la aplicación.
    logger.exception("Error no controlado en %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor."})


# ------- Modelos de entrada ------
# Los modelos que vienen a continuación definen qué datos se deben enviar a la API y de qué tipo
# es cada uno. Por ejemplo, el correo es obligatorio y debe ser texto. Los valores permitidos
# para género, dispositivo, categoría, tipo y reacción son los mismos que ya existen en los
# datos del anexo.
Genero = Literal["Femenino", "Masculino", "Otro"]
Dispositivo = Literal["Móvil", "Desktop", "Tablet"]
Categoria = Literal["Tecnología", "Cultura", "Educación", "Deportes", "Entretenimiento"]
Tipo = Literal["Texto", "Imagen", "Video"]
TipoReaccion = Literal["Me gusta", "Me encanta", "Me enoja", "Me entristece"]


def validar_hashtags(v):
    # Cada hashtag debe empezar con #, tal como están guardados en las publicaciones que ya existen.
    if v is not None and any(not h.startswith("#") or len(h) < 2 for h in v):
        raise ValueError("cada hashtag debe empezar con '#' (ej. #innovacion)")
    return v


class UsuarioIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    correo: str
    pais: str = Field(min_length=1)
    genero: Genero
    dispositivo: Dispositivo

    @field_validator("correo")
    @classmethod
    def correo_valido(cls, v):
        # Con esto se revisa que el correo tenga un formato válido, 
        # como por ejemplo: cualquiercosa@otracosa.com y se
        # guarda en minúsculas.
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("El correo no cuenta con un formato valido")
        return v.lower()


class UsuarioPatch(BaseModel):
    # Al actualizar, todos los campos son opcionales, ya que solo se envía lo que se quiere cambiar.
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=100)
    pais: Optional[str] = Field(default=None, min_length=1)
    dispositivo: Optional[Dispositivo] = None


class PublicacionIn(BaseModel):
    usuario_id: str = Field(min_length=1)
    contenido: str = Field(min_length=1, max_length=2000)
    categoria: Categoria
    tipo: Tipo
    hashtags: List[str] = Field(default_factory=list)

    @field_validator("hashtags")
    @classmethod
    def hashtags_validos(cls, v):
        return validar_hashtags(v)


class PublicacionPatch(BaseModel):
    contenido: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    hashtags: Optional[List[str]] = None

    @field_validator("hashtags")
    @classmethod
    def hashtags_validos(cls, v):
        return validar_hashtags(v)


class ReaccionIn(BaseModel):
    usuario_id: str = Field(min_length=1)
    publicacion_id: str = Field(min_length=1)
    tipo_reaccion: TipoReaccion


# ------- Funciones de apoyo ------
def nuevo_id(prefijo):
    # Los _id se generan como texto, por ejemplo "user_a1b2c3d4", igual que en los datos del
    # anexo, donde los _id no son de tipo ObjectId.
    return f"{prefijo}_{uuid.uuid4().hex[:8]}"


def ahora():
    # La fecha se guarda en hora UTC y como tipo Date, igual que las fechas que se convirtieron
    # en el punto 3.3.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def obtener_o_404(coleccion, _id):
    # Esta función busca un documento por su _id. Si no lo encuentra, responde con el código 404,
    # que significa que no existe.
    doc = get_db()[coleccion].find_one({"_id": _id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"No existe '{_id}' en {coleccion}.")
    return doc


def exigir_existe(coleccion, _id, nombre):
    # Con esta función se comprueba que lo que se está referenciando exista de verdad. Por ejemplo,
    # que el autor de una publicación sea un usuario real. Si no existe, se rechaza la solicitud
    # con el código 400.
    if get_db()[coleccion].count_documents({"_id": _id}, limit=1) == 0:
        raise HTTPException(status_code=400, detail=f"{nombre} '{_id}' no existe.")


def cambios_o_400(modelo):
    # Al actualizar, se exige que se envíe al menos un campo para modificar. Si no se envía
    # ninguno, se responde con el código 400.
    cambios = modelo.model_dump(exclude_unset=True)
    if not cambios:
        raise HTTPException(status_code=400, detail="No se envió ningún campo para actualizar.")
    return cambios


# ------- Prueba de conectividad ------
@app.get("/health", tags=["Sistema"])
def health():
    # Este endpoint sirve para comprobar, en cualquier momento, que la API logra comunicarse con Atlas.
    db = get_db()
    db.command("ping")  # si la conexión falla, se responde con el código 503
    return {"estado": "ok", "base_de_datos": db.name, "colecciones": sorted(db.list_collection_names())}


# ------- USUARIOS ------
@app.get("/usuarios", tags=["Usuarios"])
def listar_usuarios(pais: Optional[str] = None, correo: Optional[str] = None,
                    limite: int = Query(20, ge=1, le=100)):
    filtro = {}
    if pais:
        filtro["pais"] = pais
    if correo:
        filtro["correo"] = correo.lower()  # esta búsqueda utiliza el índice correo_1 del punto 2.4
    return list(get_db().usuarios.find(filtro).limit(limite))


@app.get("/usuarios/{usuario_id}", tags=["Usuarios"])
def obtener_usuario(usuario_id: str):
    return obtener_o_404("usuarios", usuario_id)


@app.post("/usuarios", status_code=201, tags=["Usuarios"])
def crear_usuario(datos: UsuarioIn):
    db = get_db()
    # Antes de insertar, se revisa que el correo no esté registrado. Esto con el fin de no tener
    # usuarios duplicados, si el correo ya existe, se responde con el código 409.
    if db.usuarios.count_documents({"correo": datos.correo}, limit=1):
        raise HTTPException(status_code=409, detail=f"Ya existe un usuario con el correo '{datos.correo}'.")
    doc = {"_id": nuevo_id("user"), **datos.model_dump(), "fecha_registro": ahora()}
    db.usuarios.insert_one(doc)
    logger.info("Usuario creado: %s", doc["_id"])
    return doc


@app.patch("/usuarios/{usuario_id}", tags=["Usuarios"])
def actualizar_usuario(usuario_id: str, datos: UsuarioPatch):
    obtener_o_404("usuarios", usuario_id)
    get_db().usuarios.update_one({"_id": usuario_id}, {"$set": cambios_o_400(datos)})
    logger.info("Usuario actualizado: %s", usuario_id)
    return get_db().usuarios.find_one({"_id": usuario_id})


@app.delete("/usuarios/{usuario_id}", tags=["Usuarios"])
def eliminar_usuario(usuario_id: str):
    obtener_o_404("usuarios", usuario_id)
    db = get_db()
    # Si el usuario tiene publicaciones, no se elimina, ya que esas publicaciones quedarían
    # sin autor. Primero hay que eliminar sus publicaciones.
    if db.publicaciones.count_documents({"usuario_id": usuario_id}, limit=1):
        raise HTTPException(status_code=409, detail="El usuario tiene publicaciones; elimínalas antes.")
    db.usuarios.delete_one({"_id": usuario_id})
    logger.info("Usuario eliminado: %s", usuario_id)
    return {"eliminado": usuario_id}


# ------- PUBLICACIONES ------
@app.get("/publicaciones", tags=["Publicaciones"])
def listar_publicaciones(usuario_id: Optional[str] = None, categoria: Optional[Categoria] = None,
                         limite: int = Query(20, ge=1, le=100)):
    filtro = {}
    if usuario_id:
        filtro["usuario_id"] = usuario_id
    if categoria:
        filtro["categoria"] = categoria
    # Las publicaciones se entregan de la más reciente a la más antigua, igual que en la
    # consulta del punto 4.3.
    return list(get_db().publicaciones.find(filtro).sort("fecha_publicacion", -1).limit(limite))


@app.get("/publicaciones/{publicacion_id}", tags=["Publicaciones"])
def obtener_publicacion(publicacion_id: str):
    return obtener_o_404("publicaciones", publicacion_id)


@app.post("/publicaciones", status_code=201, tags=["Publicaciones"])
def crear_publicacion(datos: PublicacionIn):
    exigir_existe("usuarios", datos.usuario_id, "El usuario")  # se comprueba que el autor exista
    doc = {"_id": nuevo_id("pub"), **datos.model_dump(), "fecha_publicacion": ahora()}
    get_db().publicaciones.insert_one(doc)
    logger.info("Publicación creada: %s (autor %s)", doc["_id"], doc["usuario_id"])
    return doc


@app.patch("/publicaciones/{publicacion_id}", tags=["Publicaciones"])
def actualizar_publicacion(publicacion_id: str, datos: PublicacionPatch):
    obtener_o_404("publicaciones", publicacion_id)
    get_db().publicaciones.update_one({"_id": publicacion_id}, {"$set": cambios_o_400(datos)})
    logger.info("Publicación actualizada: %s", publicacion_id)
    return get_db().publicaciones.find_one({"_id": publicacion_id})


@app.delete("/publicaciones/{publicacion_id}", tags=["Publicaciones"])
def eliminar_publicacion(publicacion_id: str):
    obtener_o_404("publicaciones", publicacion_id)
    db = get_db()
    # Se aplica el mismo criterio del punto 5, es decir, se eliminan primero los datos que
    # dependen de la publicación (reacciones, comentarios y su referencia dentro de las campañas)
    # y al final la publicación. Esto con el fin de no dejar referencias huérfanas.
    db.reacciones.delete_many({"publicacion_id": publicacion_id})
    db.comentarios.delete_many({"publicacion_id": publicacion_id})
    db.campanas.update_many({"publicaciones_asociadas": publicacion_id},
                            {"$pull": {"publicaciones_asociadas": publicacion_id}})
    db.publicaciones.delete_one({"_id": publicacion_id})
    logger.info("Publicación eliminada: %s", publicacion_id)
    return {"eliminada": publicacion_id}


# ------- REACCIONES ------
@app.post("/reacciones", status_code=201, tags=["Reacciones"])
def crear_reaccion(datos: ReaccionIn):
    # Antes de registrar la reacción, se comprueba que existan tanto el usuario como la publicación.
    exigir_existe("usuarios", datos.usuario_id, "El usuario")
    exigir_existe("publicaciones", datos.publicacion_id, "La publicación")
    doc = {"_id": nuevo_id("react"), **datos.model_dump(), "fecha": ahora()}
    # Si el usuario ya reaccionó a esa publicación, el índice único rechaza la inserción y la API
    # responde con el código 409.
    get_db().reacciones.insert_one(doc)
    logger.info("Reacción creada: %s", doc["_id"])
    return doc

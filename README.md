# ContentFlow: base de datos NoSQL en MongoDB Atlas y desarrollo de API REST

## Descripción del proyecto

Este repositorio corresponde a la Evaluación Parcial N°2 de la asignatura Base de datos no relacionales. Por un lado, se implementó en MongoDB Atlas la base de datos de la empresa ContentFlow, con las colecciones de usuarios, publicaciones, reacciones, comentarios y campañas. Por otro lado, se desarrolló una API REST en Python que se conecta a esa base de datos para leer y escribir información, esto con el fin de que las aplicaciones de la empresa puedan consultar y registrar interacciones en tiempo real.

## Estructura del repositorio

```
contentflow-mongodb-atlas_mk/
├── api/                      Código de la API REST (FastAPI + pymongo)
│   ├── __init__.py
│   └── main.py
├── scripts/                  Scripts de conexión, consultas y operaciones CRUD
│   ├── test_conexion.py
│   ├── punto_4_consultas.js
│   └── punto_5.js
├── postman/                  Colección de Postman con las pruebas de la API
├── evidencias/               Capturas de las pruebas, separadas por sección
├── .env.example              Ejemplo de variables de entorno (sin credenciales)
├── requirements.txt          Librerías necesarias para ejecutar la API
└── README.md
```

## Requisitos

- Python 3, este proyecto se desarrolló con la versión 3.14.
- Un cluster gratuito M0 en MongoDB Atlas, con los datos del anexo A ya cargados en la base de datos creada y llamada "ContentFlow_Solution_MK".
- Un usuario de base de datos con el rol "readWrite" sobre esa base, y la dirección IP del equipo agregada en Network Access.
- Postman, para probar los endpoints.


## Instalación

Desde la carpeta del proyecto, se instalan las librerías con el siguiente comando:

```
python -m pip install -r requirements.txt
```

## Variables de entorno

El string de conexión no está escrito en el código ni se sube al repositorio. Se guarda en un archivo ".env", que está excluido mediante ".gitignore". Para crearlo, se copia el archivo de ejemplo y se reemplazan los marcadores por los datos reales del cluster:


copy .env.example .env


El archivo ".env" debe contener dos variables:

```
MONGODB_URI=mongodb+srv://<usuario>:<contraseña>@<cluster>.mongodb.net/
DB_NAME=ContentFlow_Solution_MK
```

## Ejecución

Desde la raíz del proyecto, se levanta la API con el siguiente comando:


python -m uvicorn api.main:app --reload


Si la conexión con Atlas es correcta, en la consola aparece el mensaje "Conexión con MongoDB Atlas verificada". La API queda disponible en http://127.0.0.1:8000, y la documentación interactiva con todos los endpoints está en http://127.0.0.1:8000/docs

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | /health | Comprueba que la API se comunica con Atlas |
| GET | /usuarios | Lista usuarios (filtros opcionales: pais, correo) |
| GET | /usuarios/{id} | Obtiene un usuario |
| POST | /usuarios | Crea un usuario |
| PATCH | /usuarios/{id} | Actualiza nombre, país o dispositivo |
| DELETE | /usuarios/{id} | Elimina un usuario (si no tiene publicaciones) |
| GET | /publicaciones | Lista publicaciones (filtros opcionales: usuario_id, categoria) |
| GET | /publicaciones/{id} | Obtiene una publicación |
| POST | /publicaciones | Crea una publicación (el autor debe existir) |
| PATCH | /publicaciones/{id} | Actualiza contenido o hashtags |
| DELETE | /publicaciones/{id} | Elimina la publicación junto con sus reacciones y comentarios |
| POST | /reacciones | Registra una reacción (usuario y publicación deben existir) |

## Pruebas con Postman

1. Se deja corriendo la API.
2. En Postman, se importa el archivo "postman/ContentFlow_API.postman_collection.json".
3. Las solicitudes se ejecutan en orden, de arriba hacia abajo, ya que las siguientes dependen de los datos que crean las anteriores. Las variables "usuario_id" y "publicacion_id" se completan solas.
4. La última carpeta elimina los datos de prueba, para que la base quede como estaba.

## Registros de actividad

La API guarda un registro de cada solicitud (método, ruta, código de respuesta y tiempo) y de cada error en el archivo "logs/api.log". Esta carpeta se crea sola al iniciar la API y no se sube al repositorio.

## Seguridad

El repositorio no contiene usuario, contraseña ni string de conexión. Solo se publica el archivo ".env.example", que tiene marcadores en lugar de los datos reales.

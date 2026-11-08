import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

client = MongoClient(os.getenv("MONGODB_URI"), serverSelectionTimeoutMS=5000)
db = client[os.getenv("DB_NAME")]

print("ping:", client.admin.command("ping"))
print("colecciones:", db.list_collection_names())
print("usuarios:", db.usuarios.count_documents({}))
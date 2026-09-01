from app.database import Base, engine
from app import models, erp_models  # noqa: F401

Base.metadata.create_all(bind=engine)
print("ozon schema bootstrapped")

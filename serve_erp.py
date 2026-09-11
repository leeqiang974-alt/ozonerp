# -*- coding: utf-8 -*-
"""OzonERP 后端入口（看门狗调用）。
单进程直接运行 uvicorn，避免 uvicorn CLI 子进程模型丢失环境变量。
"""
import os
import sys

# 保证能 import backend/app 包（脚本可能从任意工作目录启动）
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

# 产品默认需求：批量上架后自动回填 Ozon 库存 + 库存监控线程。
# 强制开启，不依赖看门狗/计划任务传参（uvicorn 子进程会丢环境变量导致
# 库存监控线程永不启动）。如需关闭，改为 "0" 后重启。
os.environ["OZON_ENABLE_BACKGROUND_WRITES"] = "1"
os.environ["OZON_ENABLE_BACKGROUND_STOCK_MONITOR"] = "1"
os.environ.setdefault("OZON_ENABLE_BACKGROUND_POLLING", "1")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, log_level="info")

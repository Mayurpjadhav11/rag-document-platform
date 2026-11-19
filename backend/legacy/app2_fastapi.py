from fastapi import FastAPI, UploadFile, File, HTTPException
import os
import shutil

app = FastAPI()

UPLOAD_FOLDER = "data/pdfs"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.get("/")
def home():
    return {"message": "Backend is working!"}


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are allowed"
        )

    file_path = os.path.join(UPLOAD_FOLDER, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    await file.close()

    return {
        "message": "PDF uploaded successfully",
        "filename": file.filename
    }


@app.get("/documents")
def get_documents():

    files = os.listdir(UPLOAD_FOLDER)

    pdf_files = [
        file
        for file in files
        if file.lower().endswith(".pdf")
    ]

    return {
        "files": pdf_files
    }
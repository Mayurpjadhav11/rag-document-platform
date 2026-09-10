from flask import Flask, request, jsonify
import os

app = Flask(__name__)

UPLOAD_FOLDER = "data/pdfs"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route("/")
def home():
    return "Backend is working!"


@app.route("/upload", methods=["POST"])
def upload_pdf():

    file = request.files["file"]

    if not file.filename.endswith(".pdf"):
        return jsonify({"error": "Only PDF files are allowed"}), 400

    file_path = os.path.join(UPLOAD_FOLDER, file.filename)

    file.save(file_path)

    return jsonify({
        "message": "PDF uploaded successfully",
        "filename": file.filename
    })


@app.route("/documents", methods=["GET"])
def get_documents():

    files = os.listdir(UPLOAD_FOLDER)

    pdf_files = []

    for file in files:
        if file.endswith(".pdf"):
            pdf_files.append(file)

    return jsonify(pdf_files)

@app.route("/filenames", methods=["GET"])
def get_filenames():

    files = os.listdir(UPLOAD_FOLDER)

    pdf_names = []

    for file in files:
        if file.endswith(".pdf"):
            pdf_names.append(file)

    return jsonify({
        "files": pdf_names
    })


if __name__ == "__main__":
    app.run(debug=True)
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route("/")
def home(): 
    return "MotiFi backend is running!"

@app.route("/budget", methods=["POST"])
def budget():
    data = request.json
    return jsonify({
        "values": data.get('values'),
        "message": f"Budget for {data.get('name')}",
        "income": data.get('income')
        
    })

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5001)
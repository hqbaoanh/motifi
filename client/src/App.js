import React, { useState } from "react";

function App() {
  const [name, setName] = useState("");
  const [income, setIncome] = useState("");
  const [values, setValues] = useState("");

  const handleSubmit = async () => {
    const payload = { name, income, values };

    try {
      const response = await fetch("http://localhost:5001/budget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      const ordered = {
        message: result.message, 
        income: result.income, 
        values: result.values
      }
      alert(JSON.stringify(ordered, null, 2));
    } catch (error) {
      alert("Error sending data: " + error.message);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '400px', margin: 'auto' }}>
      <h1>MotiFi Budget Input</h1>
  
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
        <label style={{ width: '120px' }}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
  
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
        <label style={{ width: '120px' }}>Monthly Income</label>
        <input value={income} onChange={(e) => setIncome(e.target.value)} />
      </div>
  
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
        <label style={{ width: '120px' }}>Top Values</label>
        <input value={values} onChange={(e) => setValues(e.target.value)} />
      </div>
  
      <button onClick={handleSubmit} style={{ marginTop: '10px' }}>
        Submit
      </button>
    </div>
  );
}

export default App;
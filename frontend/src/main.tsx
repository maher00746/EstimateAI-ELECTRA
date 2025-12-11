import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Login from "./Login";
import "./style.css";

function Root() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleLogin = () => {
    setIsLoggedIn(true);
  };

  return isLoggedIn ? <App /> : <Login onLogin={handleLogin} />;
}

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

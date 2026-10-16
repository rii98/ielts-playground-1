import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { FeedbackPage } from "./Feedback.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(location.pathname === "/feedback" ? <FeedbackPage /> : <App />);

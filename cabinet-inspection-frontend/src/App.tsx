// All pages and their URLs.
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { FeedbackProvider } from "./components/Feedback";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import InspectionDetail from "./pages/InspectionDetail";
import NewInspection from "./pages/NewInspection";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <FeedbackProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inspect" element={<NewInspection />} />
            <Route path="/history" element={<History />} />
            <Route path="/inspections/:id" element={<InspectionDetail />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </FeedbackProvider>
    </BrowserRouter>
  );
}

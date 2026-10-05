import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-20 text-center">
      <div className="bg-linear-to-r from-sky-400 to-indigo-500 bg-clip-text text-6xl font-extrabold text-transparent">404</div>
      <p className="text-sm text-muted">This page does not exist.</p>
      <Link to="/" className="btn btn-primary">
        Go to dashboard
      </Link>
    </div>
  );
}

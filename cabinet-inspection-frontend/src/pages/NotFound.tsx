import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-20 text-center">
      <div className="text-5xl font-extrabold text-slate-200">404</div>
      <p className="text-sm text-slate-500">This page does not exist.</p>
      <Link to="/" className="btn btn-primary">
        Go to dashboard
      </Link>
    </div>
  );
}

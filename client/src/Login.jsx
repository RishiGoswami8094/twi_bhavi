import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const Login = ({ setIsAuthenticated }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        const endpoint = isRegistering ? '/api/register' : '/api/login';

        try {
            await axios.post(`${BACKEND_URL}${endpoint}`,
                { username, password },
                { withCredentials: true }
            );
            setIsAuthenticated(true);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Authentication failed');
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
            <div className="bg-gray-800 p-10 shadow-lg w-[300px] border border-gray-700">
                <h2 className="text-2xl font-bold mb-8 text-center text-blue-400">
                    {isRegistering ? 'Register' : 'Login'}
                </h2>
                {error && <div className="bg-red-900 text-red-200 px-4 py-3 mb-6 text-sm text-center">{error}</div>}
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div >
                        <label className="block text-sm text-gray-400 mb-2">Username</label>
                        <input
                            type="text"
                            className="w-[292px] bg-gray-700 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Password</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                className="w-[292px] bg-gray-700 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white px-2 py-1"
                            >
                                {showPassword ? 'hide' : 'show'}
                            </button>
                        </div>
                    </div>
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 px-4 py-3 mt-4 font-bold transition">
                        {isRegistering ? 'Sign Up' : 'Sign In'}
                    </button>
                </form>

                <p className="mt-4 text-center text-sm text-gray-400">
                    {isRegistering ? "" : ""}
                </p>

            </div>
        </div>
    );
};

export default Login;

{/* <p className="mt-4 text-center text-sm text-gray-400">
    {isRegistering ? "Already have an account?" : "Don't have an account?"}
    <button
        onClick={() => setIsRegistering(!isRegistering)}
        className="text-blue-400 hover:underline ml-1"
    >
        {isRegistering ? 'Login' : 'Register'}
    </button>
</p> */}
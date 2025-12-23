
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'tech-circle';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  isLoading, 
  className = '', 
  disabled, 
  ...props 
}) => {
  const baseStyle = "font-medium transition-all duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed active:scale-95";
  
  const variants = {
    primary: "px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-500/30",
    secondary: "px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50",
    danger: "px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30",
    ghost: "px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700",
    'tech-circle': "w-40 h-40 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)] border-4 border-white/20 hover:shadow-[0_0_40px_rgba(59,130,246,0.8)] relative overflow-hidden group"
  };

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : null}
      {children}
      {variant === 'tech-circle' && (
        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
};

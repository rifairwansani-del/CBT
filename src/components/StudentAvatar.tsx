import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { withAuthTokenUrl } from '../lib/api.ts';

interface StudentAvatarProps {
  photoUrl?: string | null;
  fullName: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-9 h-9',
  md: 'w-11 h-11',
  lg: 'w-16 h-16',
  xl: 'w-24 h-32',
  '2xl': 'w-32 h-44 sm:w-36 sm:h-48',
};

export const StudentAvatar: React.FC<StudentAvatarProps> = ({
  photoUrl,
  fullName,
  size = 'md',
  className = '',
}) => {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [photoUrl]);

  if (!photoUrl || errored) {
    return (
      <div
        className={`${SIZE_MAP[size]} ${className} rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-slate-400 shrink-0 select-none`}
        title={`Avatar standar: ${fullName}`}
      >
        <User className={size === '2xl' ? 'w-12 h-12' : size === 'xl' ? 'w-9 h-9' : size === 'lg' ? 'w-7 h-7' : 'w-4 h-4'} />
        {(size === 'xl' || size === '2xl') && <span className="text-[11px] font-medium text-slate-500 mt-1">Tanpa Foto</span>}
      </div>
    );
  }

  return (
    <img
      src={withAuthTokenUrl(photoUrl)}
      alt={`Foto resmi ${fullName}`}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className={`${SIZE_MAP[size]} ${className} rounded-lg object-cover border border-slate-200 bg-slate-100 shrink-0`}
    />
  );
};

'use client';
import React from 'react';
import dynamic from 'next/dynamic';

// Memanggil file SignClient secara khusus di browser saja (ssr: false)
const SignClient = dynamic(() => import('./SignClient'), {
  ssr: false,
  loading: () => <div className="text-center p-10 text-black font-semibold">Mempersiapkan Lembar Kerja Web Browser...</div>
});

export default function SignPage({ params }) {
  const unpackedParams = React.use(params);
  const id = unpackedParams.id;

  return <SignClient id={id} />;
}
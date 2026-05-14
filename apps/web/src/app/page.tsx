import dynamic from 'next/dynamic';

const PhaserMount = dynamic(() => import('@/components/PhaserMount'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        color: '#fff',
        textAlign: 'center',
        paddingTop: '40vh',
        fontFamily: 'sans-serif',
      }}
    >
      Loading...
    </div>
  ),
});

export default function HomePage() {
  return (
    <>
      <div id="root" />
      <PhaserMount />
    </>
  );
}

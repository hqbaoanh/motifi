import React from 'react';
import CTAButton from '../../components/CTAButtion';

const HomePage = () => {
    return (
        <div className="text-center p-10">
            <h1 className="text-4x1 font-bold mb-4"> MotiFi - You're richer than you think 💸</h1>
            <p className="mb-8 text-gray-600">Plan smarter. Spend wiser. Live better</p>
            <CTAButton href="/form" text="Start Budgeting" />
        </div>
    );
};
export default HomePage; 
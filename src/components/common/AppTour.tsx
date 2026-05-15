import { Joyride, STATUS } from 'react-joyride';
import type { Step } from 'react-joyride';
export type { Step };
import { useTranslation } from 'react-i18next';
import { useContext } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { addRewardBalance } from '../../data/firestore';

interface AppTourProps {
  run: boolean;
  steps: Step[];
  tourId: string;
  eurReward?: number;
  onFinish?: () => void;
}

export const AppTour: React.FC<AppTourProps> = ({ run, steps, tourId, eurReward = 50, onFinish }) => {
  const { t } = useTranslation();
  const { profile, updateSessionProfile } = useContext(AuthContext);

  const handleJoyrideCallback = async (data: any) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      if (profile && !profile.completedTours?.includes(tourId)) {
         const result = await addRewardBalance(profile.uid, eurReward, tourId);
         if (result) {
            updateSessionProfile({
              rewardBalance: result.newBalance,
              completedTours: result.completedTours
            });
         }
      }
      
      if (onFinish) {
        onFinish();
      }
    }
  };

  return (
    <Joyride
      onEvent={handleJoyrideCallback}
      continuous
      run={run}
      scrollToFirstStep
      steps={steps}
      options={{
        showProgress: true,
        primaryColor: '#0A3D91',
        buttons: ['back', 'close', 'primary', 'skip'],
      }}
      locale={{
        back: t('tour.back', 'Wstecz'),
        close: t('tour.close', 'Zamknij'),
        last: t('tour.last', 'Zakończ'),
        next: t('tour.next', 'Dalej'),
        skip: t('tour.skip', 'Pomiń'),
      }}
      styles={{
        tooltipContainer: {
          textAlign: 'left',
        },
        buttonPrimary: {
          backgroundColor: '#0A3D91',
          borderRadius: '8px',
          fontWeight: 'bold',
          padding: '8px 16px',
        },
        buttonBack: {
          marginRight: '8px',
          color: '#64748B',
        },
        buttonSkip: {
          color: '#94A3B8',
          fontSize: '13px',
        }
      }}
    />
  );
};

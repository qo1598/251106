import { useState, useEffect, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../utils/supabase';
import { RoomParticipant, GameSession, Droplet } from '../../types';
import { getRoomParticipants, getRoomProblem } from '../../services/roomService';

interface UseRoomRealtimeReturn {
  participants: RoomParticipant[];
  roomStatus: string | null;
  gameSessions: GameSession[];
  currentProblem: Droplet | null;
  refreshParticipants: () => Promise<void>;
}

/**
 * 방 실시간 업데이트 Hook
 * Supabase Realtime을 사용하여 방 상태, 참가자, 게임 세션을 실시간으로 동기화
 */
export const useRoomRealtime = (roomId: string | null): UseRoomRealtimeReturn => {
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [roomStatus, setRoomStatus] = useState<string | null>(null);
  const [gameSessions, setGameSessions] = useState<GameSession[]>([]);
  const [currentProblem, setCurrentProblem] = useState<Droplet | null>(null);

  /**
   * 참가자 목록 새로고침
   */
  const refreshParticipants = useCallback(async () => {
    if (!roomId) return;

    console.log('[useRoomRealtime] refreshParticipants 시작:', roomId);
    const { participants: fetchedParticipants, error } = await getRoomParticipants(roomId);

    console.log('[useRoomRealtime] refreshParticipants 결과:', { 
      count: fetchedParticipants?.length || 0, 
      error: error,
      participants: fetchedParticipants?.map(p => ({ id: p.user_id, nickname: p.user?.nickname }))
    });

    if (!error && fetchedParticipants) {
      // 데이터가 실제로 변경되었을 때만 상태 업데이트 (불필요한 리렌더링 방지)
      setParticipants(prev => {
        const prevHash = JSON.stringify(prev.map(p => p.user_id).sort());
        const newHash = JSON.stringify(fetchedParticipants.map(p => p.user_id).sort());
        
        if (prevHash !== newHash) {
          console.log('[useRoomRealtime] 참가자 목록 업데이트:', fetchedParticipants.length, '명 (변경 감지)');
          return fetchedParticipants;
        } else {
          console.log('[useRoomRealtime] 참가자 목록 변경 없음, 업데이트 스킵');
          return prev;
        }
      });
    } else if (error) {
      console.error('[useRoomRealtime] 참가자 목록 새로고침 실패:', error);
    }
  }, [roomId]);

  /**
   * 방 존재 여부 확인
   */
  const checkRoomExists = useCallback(async (): Promise<boolean> => {
    if (!roomId) return false;

    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('id')
        .eq('id', roomId)
        .single();

      if (error || !data) {
        console.log('[useRoomRealtime] 방이 존재하지 않음:', roomId);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[useRoomRealtime] 방 존재 확인 오류:', err);
      return false;
    }
  }, [roomId]);

  /**
   * 방 상태 확인 (폴링용)
   */
  const checkRoomStatus = useCallback(async (): Promise<string | null> => {
    if (!roomId) return null;

    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('status')
        .eq('id', roomId)
        .single();

      if (error || !data) {
        console.log('[useRoomRealtime] 방 상태 확인 실패:', error);
        return null;
      }

      return data.status;
    } catch (err) {
      console.error('[useRoomRealtime] 방 상태 확인 오류:', err);
      return null;
    }
  }, [roomId]);

  /**
   * 게임 세션 로드
   */
  const loadGameSessions = useCallback(async () => {
    if (!roomId) return;
    
    console.log('[useRoomRealtime] 게임 세션 로드');
    const { data, error } = await supabase
      .from('game_sessions')
      .select('*, users(id, nickname)')
      .eq('room_id', roomId)
      .order('played_at', { ascending: false }); // 최신 순으로 정렬

    if (!error && data) {
      // 각 사용자당 가장 최신 세션만 선택
      const userSessionsMap = new Map<string, any>();
      
      data.forEach((s: any) => {
        const userId = s.user_id;
        const existing = userSessionsMap.get(userId);
        
        // 기존 세션이 없거나, 현재 세션이 더 최신이면 업데이트
        if (!existing || new Date(s.played_at) > new Date(existing.played_at)) {
          userSessionsMap.set(userId, s);
        }
      });

      const uniqueSessions = Array.from(userSessionsMap.values());

      const sessions: GameSession[] = uniqueSessions.map((s: any) => ({
        id: s.id,
        room_id: s.room_id,
        user_id: s.user_id,
        user: s.users,
        score: s.score,
        correct_count: s.correct_count,
        total_count: s.total_count,
        accuracy: s.accuracy,
        difficulty: s.difficulty,
        played_at: s.played_at,
      }));
      
      // 데이터가 실제로 변경되었을 때만 상태 업데이트 (불필요한 리렌더링 방지)
      setGameSessions(prev => {
        // userId와 score 기준으로 해시 생성 (점수 변경 감지)
        const prevHash = JSON.stringify(prev.map(s => ({ userId: s.user_id, score: s.score })).sort((a, b) => a.userId.localeCompare(b.userId)));
        const newHash = JSON.stringify(sessions.map(s => ({ userId: s.user_id, score: s.score })).sort((a, b) => a.userId.localeCompare(b.userId)));
        
        if (prevHash !== newHash) {
          console.log('[useRoomRealtime] 게임 세션 로드 완료:', sessions.length, '개 (변경 감지)');
          console.log('[useRoomRealtime] 세션 점수:', sessions.map(s => ({ userId: s.user_id, score: s.score, nickname: s.user?.nickname })));
          return sessions;
        } else {
          console.log('[useRoomRealtime] 게임 세션 변경 없음, 업데이트 스킵');
          return prev;
        }
      });
    } else if (error) {
      console.error('[useRoomRealtime] 게임 세션 로드 실패:', error);
    }
  }, [roomId]);

  /**
   * 현재 문제 로드
   */
  const loadCurrentProblem = useCallback(async () => {
    if (!roomId) return;
    
    console.log('[useRoomRealtime] 현재 문제 로드 시작:', roomId);
    const { problem, error } = await getRoomProblem(roomId);
    
    console.log('[useRoomRealtime] 현재 문제 로드 결과:', { 
      hasProblem: !!problem, 
      problemText: problem?.problem,
      error: error 
    });
    
    if (!error && problem) {
      console.log('[useRoomRealtime] 현재 문제 로드 완료:', problem.problem);
      setCurrentProblem(problem);
    } else if (error) {
      console.error('[useRoomRealtime] 현재 문제 로드 실패:', error);
    } else {
      // 문제가 없으면 null로 설정
      console.log('[useRoomRealtime] 문제 없음');
      setCurrentProblem(null);
    }
  }, [roomId]);

  /**
   * 초기 데이터 로드 및 실시간 구독 설정
   */
  useEffect(() => {
    if (!roomId) {
      setParticipants([]);
      setRoomStatus(null);
      setGameSessions([]);
      setCurrentProblem(null);
      return;
    }

    let roomChannel: RealtimeChannel | undefined;
    let participantsChannel: RealtimeChannel | undefined;
    let sessionsChannel: RealtimeChannel | undefined;
    let participantsInterval: NodeJS.Timeout | undefined;
    let roomCheckInterval: NodeJS.Timeout | undefined;
    let sessionsRefreshInterval: NodeJS.Timeout | undefined;
    let problemCheckInterval: NodeJS.Timeout | undefined;

    const setupRealtimeSubscriptions = async () => {
      console.log('[useRoomRealtime] 실시간 구독 설정 시작:', roomId);
      
      // 초기 참가자 목록 및 방 상태 로드
      await refreshParticipants();
      
      // 초기 방 상태 로드
      const initialStatus = await checkRoomStatus();
      if (initialStatus) {
        console.log('[useRoomRealtime] 초기 방 상태:', initialStatus);
        setRoomStatus(initialStatus);
      }

      // 초기 문제 로드
      await loadCurrentProblem();
      
      // 문제 주기적 확인 (실시간 구독이 실패할 경우 대비)
      problemCheckInterval = setInterval(async () => {
        console.log('[useRoomRealtime] 문제 주기적 확인');
        await loadCurrentProblem();
      }, 2000);

      // 방 상태 실시간 구독 (UPDATE 및 DELETE)
      console.log('[useRoomRealtime] 방 상태 구독 설정');
      roomChannel = supabase
        .channel(`room:${roomId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'rooms',
            filter: `id=eq.${roomId}`,
          },
          async (payload) => {
            console.log('[useRoomRealtime] 방 상태 변경:', payload.new);
            const updatedRoom = payload.new as any;
            setRoomStatus(updatedRoom.status);
            
            // 문제 정보도 업데이트
            console.log('[useRoomRealtime] current_problem 확인:', updatedRoom.current_problem);
            if (updatedRoom.current_problem) {
              const problemData = updatedRoom.current_problem as any;
              const problem: Droplet = {
                id: Date.now(),
                multiplicand: problemData.multiplicand,
                multiplier: problemData.multiplier,
                answer: problemData.answer,
                problem: problemData.problem,
                x: problemData.x,
                y: problemData.y,
                speed: problemData.speed,
                itemType: problemData.itemType,
              };
              
              // createdAt 정보도 포함 (중복 체크용)
              (problem as any).createdAt = problemData.createdAt || new Date().toISOString();
              
              console.log('[useRoomRealtime] 문제 업데이트:', problem.problem, 'x:', problem.x, 'createdAt:', (problem as any).createdAt);
              setCurrentProblem(problem);
            } else {
              console.log('[useRoomRealtime] 문제 없음, null로 설정');
            setCurrentProblem(null);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        () => {
          console.log('[useRoomRealtime] 방이 삭제되었습니다');
          setRoomStatus('deleted');
          // 방이 삭제되면 참가자 목록도 초기화
          setParticipants([]);
        }
      )
      .subscribe((status) => {
        console.log('[useRoomRealtime] 방 상태 구독 상태:', status);
        if (status === 'SUBSCRIBED') {
          console.log('[useRoomRealtime] 방 상태 구독 성공');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[useRoomRealtime] 방 상태 구독 실패:', status);
        }
      });

      // 참가자 실시간 구독 (INSERT, UPDATE, DELETE)
      console.log('[useRoomRealtime] 참가자 구독 설정');
      participantsChannel = supabase
        .channel(`room_participants:${roomId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'room_participants',
            filter: `room_id=eq.${roomId}`,
          },
          async (payload) => {
            console.log('[useRoomRealtime] 참가자 추가:', payload.new);
            // 참가자 목록 새로고침
            await refreshParticipants();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'room_participants',
            filter: `room_id=eq.${roomId}`,
          },
          async (payload) => {
            console.log('[useRoomRealtime] 참가자 삭제:', payload.old);
            // 참가자 목록 새로고침
            await refreshParticipants();
          }
        )
        .subscribe((status) => {
          console.log('[useRoomRealtime] 참가자 구독 상태:', status);
          if (status === 'SUBSCRIBED') {
            console.log('[useRoomRealtime] 참가자 구독 성공');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('[useRoomRealtime] 참가자 구독 실패:', status);
          }
        });

      // 게임 세션 실시간 구독 (INSERT 및 UPDATE)
      sessionsChannel = supabase
        .channel(`game_sessions:${roomId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'game_sessions',
            filter: `room_id=eq.${roomId}`,
          },
          async (payload) => {
            console.log('[useRoomRealtime] 게임 세션 추가:', payload.new);
            const newSession = payload.new as GameSession;

            // 사용자 정보 조회
            const { data: userData } = await supabase
              .from('users')
              .select('id, nickname, best_score, created_at, updated_at')
              .eq('id', newSession.user_id)
              .single();

            const sessionWithUser: GameSession = {
              ...newSession,
              user: userData ? {
                id: userData.id,
                nickname: userData.nickname,
                best_score: userData.best_score,
                created_at: userData.created_at,
                updated_at: userData.updated_at,
              } : undefined,
            };

            setGameSessions((prev) => {
              // 중복 체크 (같은 ID 또는 같은 사용자의 더 최신 세션이 있으면 스킵)
              const existingById = prev.find((s) => s.id === sessionWithUser.id);
              if (existingById) {
                console.log('[useRoomRealtime] 동일 ID 세션 존재, 스킵:', sessionWithUser.id);
                return prev;
              }
              
              // 같은 사용자의 기존 세션 확인
              const existingByUser = prev.find((s) => s.user_id === sessionWithUser.user_id);
              if (existingByUser) {
                // 새 세션이 더 최신이면 교체, 아니면 스킵
                if (new Date(sessionWithUser.played_at) > new Date(existingByUser.played_at)) {
                  console.log('[useRoomRealtime] 사용자 세션 교체:', sessionWithUser.user_id, existingByUser.score, '->', sessionWithUser.score);
                  const filtered = prev.filter(s => s.user_id !== sessionWithUser.user_id);
                  return [...filtered, sessionWithUser].sort((a, b) => b.score - a.score);
                }
                console.log('[useRoomRealtime] 기존 세션이 더 최신, 스킵:', sessionWithUser.user_id);
                return prev;
              }
              
              console.log('[useRoomRealtime] 새 세션 추가 (INSERT):', sessionWithUser.user_id, sessionWithUser.score);
              return [...prev, sessionWithUser].sort((a, b) => b.score - a.score);
            });
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'game_sessions',
            filter: `room_id=eq.${roomId}`,
          },
          async (payload) => {
            console.log('[useRoomRealtime] 게임 세션 업데이트:', payload.new);
            const updatedSession = payload.new as GameSession;

            // 사용자 정보 조회
            const { data: userData } = await supabase
              .from('users')
              .select('id, nickname, best_score, created_at, updated_at')
              .eq('id', updatedSession.user_id)
              .single();

            const sessionWithUser: GameSession = {
              ...updatedSession,
              user: userData ? {
                id: userData.id,
                nickname: userData.nickname,
                best_score: userData.best_score,
                created_at: userData.created_at,
                updated_at: userData.updated_at,
              } : undefined,
            };

            setGameSessions((prev) => {
              // 기존 세션 업데이트 또는 추가
              const existingIndex = prev.findIndex((s) => s.id === sessionWithUser.id);
              if (existingIndex >= 0) {
                // 점수가 변경되지 않았으면 업데이트 스킵
                if (prev[existingIndex].score === sessionWithUser.score) {
                  console.log('[useRoomRealtime] 점수 변경 없음, 업데이트 스킵:', sessionWithUser.user_id, sessionWithUser.score);
                  return prev;
                }
                console.log('[useRoomRealtime] 세션 점수 업데이트:', sessionWithUser.user_id, prev[existingIndex].score, '->', sessionWithUser.score);
                const updated = [...prev];
                updated[existingIndex] = sessionWithUser;
                return updated.sort((a, b) => b.score - a.score);
              } else {
                console.log('[useRoomRealtime] 새 세션 추가:', sessionWithUser.user_id, sessionWithUser.score);
                return [...prev, sessionWithUser].sort((a, b) => b.score - a.score);
              }
            });
          }
        )
        .subscribe((status) => {
          console.log('[useRoomRealtime] 게임 세션 구독 상태:', status);
          if (status === 'SUBSCRIBED') {
            console.log('[useRoomRealtime] 게임 세션 구독 성공');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('[useRoomRealtime] 게임 세션 구독 실패:', status);
          }
        });

      // 초기 게임 세션 로드
      await loadGameSessions();

      // 참가자 목록 3초마다 자동 갱신
      console.log('[useRoomRealtime] 참가자 목록 자동 갱신 시작 (3초 간격)');
      participantsInterval = setInterval(async () => {
        console.log('[useRoomRealtime] 자동 갱신: 참가자 목록 새로고침');
        await refreshParticipants();
      }, 3000);

      // 게임 세션 2초마다 자동 갱신 (실시간 점수 동기화) - 주기 단축으로 실시간성 향상
      console.log('[useRoomRealtime] 게임 세션 자동 갱신 시작 (2초 간격)');
      sessionsRefreshInterval = setInterval(async () => {
        console.log('[useRoomRealtime] 자동 갱신: 게임 세션 새로고침');
        await loadGameSessions();
      }, 2000);

      // 방 존재 여부 및 상태 2초마다 확인 (방 삭제 감지 및 상태 동기화)
      console.log('[useRoomRealtime] 방 존재 여부 및 상태 확인 시작 (2초 간격)');
      roomCheckInterval = setInterval(async () => {
        const exists = await checkRoomExists();
        if (!exists) {
          console.log('[useRoomRealtime] 방이 삭제됨 (주기적 확인)');
          setRoomStatus('deleted');
          setParticipants([]);
          // 인터벌 정리
          if (participantsInterval) clearInterval(participantsInterval);
          if (roomCheckInterval) clearInterval(roomCheckInterval);
          if (sessionsRefreshInterval) clearInterval(sessionsRefreshInterval);
          if (problemCheckInterval) clearInterval(problemCheckInterval);
          return;
        }

        // 방 상태도 확인하여 실시간 구독이 실패한 경우 대비
        const currentStatus = await checkRoomStatus();
        if (currentStatus) {
          console.log('[useRoomRealtime] 방 상태 확인 (폴링):', currentStatus);
          setRoomStatus(currentStatus);
        }
      }, 2000);
    };

    setupRealtimeSubscriptions();

    // Cleanup
    return () => {
      if (participantsInterval) {
        clearInterval(participantsInterval);
      }
      if (roomCheckInterval) {
        clearInterval(roomCheckInterval);
      }
      if (sessionsRefreshInterval) {
        clearInterval(sessionsRefreshInterval);
      }
      if (problemCheckInterval) {
        clearInterval(problemCheckInterval);
      }
      if (roomChannel) {
        supabase.removeChannel(roomChannel);
      }
      if (participantsChannel) {
        supabase.removeChannel(participantsChannel);
      }
      if (sessionsChannel) {
        supabase.removeChannel(sessionsChannel);
      }
    };
  }, [roomId, refreshParticipants, checkRoomExists, checkRoomStatus, loadGameSessions, loadCurrentProblem]);

  return {
    participants,
    roomStatus,
    gameSessions,
    currentProblem,
    refreshParticipants,
  };
};

